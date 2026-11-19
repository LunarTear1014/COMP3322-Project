import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { build_report } from "../api_v1/effectiveness.js";
import { create_utc_pool } from "../db/pool.js";
import { create_password_hasher } from "../features/users/password_hasher.js";
import { prepare_database, test_db_config } from "../../test/db_helper.js";
import { attach_demo_club_icons } from "./demo_club_icons.js";
import { attach_demo_club_photos } from "./demo_club_photos.js";
import { CLUBS, EVENTS, seed_demo } from "./demo_seed.js";

const { skip } = test_db_config();
const FAST = create_password_hasher({ params: { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } });
let db;
let pool;
let result;

const count = async (sql, params = []) => Number((await db.admin.query(sql, params))[0][0].n);

describe("demo seed", { skip }, () => {
  before(async () => {
    db = await prepare_database();
    // The deployment catalogue (schema.sql + deployment-seed.sql) has three clubs and venues already.
    await db.admin.query(`INSERT INTO clubs (name, description) VALUES ('Photography Society', 'x'), ('Film Society', 'x'), ('Debate Club', 'x');
      INSERT INTO venues (name, location, capacity, description) VALUES ('Lok Yew Hall', 'Main Campus', 80, 'x'), ('Main Building Room 230', 'Main Building', 35, 'x'), ('GoldenScene Cinema', 'Kennedy Town', 120, 'x');`);
    pool = create_utc_pool({ ...db.config, connection_limit: 8 });
    result = await seed_demo({ pool, password: "demo-password-123", now: new Date("2026-11-16T04:00:00Z"), hasher: FAST, log: null });
  });
  after(async () => { await pool?.end(); await db?.close(); });

  test("seeds event page views from members, non-members and the committee, never in the future", async () => {
    const views = await count("SELECT COUNT(*) AS n FROM event_views");
    assert.ok(views > 0 && views <= result.summary.views, `${views} rows for ${result.summary.views} recorded views`);
    for (const role of ["member", "none", "committee"]) {
      assert.ok(await count("SELECT COUNT(*) AS n FROM event_views WHERE viewer_role = ?", [role]) > 0, `views with viewer_role ${role}`);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM event_views WHERE viewer_role IS NULL"), 0, "the seed records membership at view time");
    assert.equal(await count("SELECT COUNT(*) AS n FROM event_views WHERE viewed_at > ?", ["2026-11-16 04:00:00"]), 0, "no view after the seed's now");
    assert.equal(await count("SELECT COUNT(*) AS n FROM event_views v JOIN events e ON e.id = v.event_id WHERE v.viewed_at >= e.start_time"), 0, "no view after the event starts");
    // Some people look without registering, members and non-members alike.
    const browsed = `SELECT COUNT(DISTINCT v.event_id, v.user_id) AS n FROM event_views v
      LEFT JOIN participations p ON p.event_id = v.event_id AND p.user_id = v.user_id
      WHERE p.user_id IS NULL AND v.viewer_role = ?`;
    assert.ok(await count(browsed, ["member"]) > 0, "members who looked but did not register");
    assert.ok(await count(browsed, ["none"]) > 0, "non-members who looked but did not register");
  });

  test("creates the clubs, accounts and roles", async () => {
    assert.equal(await count("SELECT COUNT(*) AS n FROM clubs"), CLUBS.length);
    assert.equal(await count("SELECT COUNT(*) AS n FROM venues"), 5);
    assert.equal(result.accounts.length, 37);
    assert.equal(await count("SELECT COUNT(*) AS n FROM memberships WHERE role = 'president'"), 5);
    assert.equal(await count("SELECT COUNT(*) AS n FROM memberships WHERE role = 'committee'"), 10);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE platform_role = 'venue_admin'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM club_join_requests WHERE status = 'pending'"), 3);
  });

  test("creates events in every state the app shows", async () => {
    assert.equal(await count("SELECT COUNT(*) AS n FROM events"), EVENTS.length);
    assert.ok(EVENTS.length >= 20);
    const now = "2026-11-16 04:00:00";
    assert.equal(await count("SELECT COUNT(*) AS n FROM events WHERE status = 'published' AND start_time < ?", [now]), 6);
    assert.equal(await count("SELECT COUNT(*) AS n FROM events WHERE status = 'published' AND start_time > ?", [now]), 15);
    assert.equal(await count("SELECT COUNT(*) AS n FROM events WHERE status = 'cancelled'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM events WHERE status = 'awaiting_president'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM bookings WHERE status = 'awaiting_president'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM event_attendance"), EVENTS.filter((e) => e.flow === "past").reduce((n, e) => n + e.attend, 0));
    assert.equal(await count("SELECT COUNT(*) AS n FROM participations WHERE status = 'waitlisted'"), 2, "Lion Rock is over capacity");
    assert.ok(await count("SELECT COUNT(*) AS n FROM event_join_requests WHERE status = 'pending'") >= 3);
  });

  test("every club's activity report shows people leaving, rejoining, queueing and being promoted", async () => {
    const [clubs] = await db.admin.query("SELECT id, name FROM clubs ORDER BY id");
    assert.equal(clubs.length, CLUBS.length);
    // Only the events that already happened: 2026-10-01 up to the seed's "now".
    const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-16T04:00:00Z") };
    for (const club of clubs) {
      const { events } = await build_report(pool, { club_id: club.id, ...range });
      assert.ok(events.length >= 1, `${club.name} has past events`);
      const sum = (key) => events.reduce((n, event) => n + event[key], 0);
      assert.ok(sum("dropped_out") >= 1, `${club.name}: someone dropped out`);
      assert.ok(sum("promotions") >= 1, `${club.name}: a leave promoted someone`);
      assert.ok(events.some((event) => event.peak_waitlist >= 1), `${club.name}: a waitlist formed`);
      assert.ok(events.some((event) => event.median_promotion_wait_hours !== null && event.median_promotion_wait_hours > 0), `${club.name}: promotion wait is measured`);
      assert.ok(events.some((event) => event.joins_24h_after_publish < event.ever_joined), `${club.name}: joins were spread over several days`);
      assert.ok(events.some((event) => event.view_to_join > 0), `${club.name}: viewers became joiners`);
      assert.ok(events.every((event) => event.attended <= event.joined_at_start), `${club.name}: attendance matches the seats held`);
      assert.ok(await count("SELECT COUNT(*) AS n FROM participation_history h JOIN events e ON e.id = h.event_id WHERE e.club_id = ? AND h.action = 'left'", [club.id]) >= 2, `${club.name}: leave rows exist`);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM participation_history WHERE occurred_at > ?", ["2026-11-16 04:00:00"]), 0, "nothing is dated in the future");
    assert.equal(await count("SELECT COUNT(*) AS n FROM participation_history WHERE action = 'promoted'"), result.summary.promotions);
    assert.equal(await count("SELECT COUNT(*) AS n FROM participation_history WHERE action = 'left'"), result.summary.leaves);
  });

  test("demo users can sign in with the shared password, and a second run does nothing", async () => {
    const [[user]] = await db.admin.query("SELECT password_hash FROM users WHERE email = 'president.photo@clubspace.example'");
    assert.equal((await FAST.verify("demo-password-123", user.password_hash)).ok, true);
    const again = await seed_demo({ pool, password: "demo-password-123", hasher: FAST, log: null });
    assert.ok(again.skipped);
    assert.equal(await count("SELECT COUNT(*) AS n FROM events"), EVENTS.length);
  });
  test("club icons: every demo club gets one, a second run changes nothing and an uploaded icon is never replaced", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "club-icons-"));
    try {
      const first = await attach_demo_club_icons({ pool, cover_dir: dir, now: new Date("2026-11-16T04:00:00Z"), log: null });
      assert.deepEqual(first, { attached: CLUBS.length, already: 0, missing: 0 });
      assert.equal(await count("SELECT COUNT(*) AS n FROM clubs WHERE icon_key IS NULL"), 0);
      assert.equal((await readdir(dir)).filter((name) => name.endsWith(".icon.webp")).length, CLUBS.length);
      assert.equal(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'club.icon_set' AND actor_user_id IS NOT NULL"), CLUBS.length);
      const again = await attach_demo_club_icons({ pool, cover_dir: dir, log: null });
      assert.deepEqual(again, { attached: 0, already: CLUBS.length, missing: 0 });
      assert.equal((await readdir(dir)).length, CLUBS.length, "no extra files written");
      const custom = "c".repeat(32);
      await db.admin.query("UPDATE clubs SET icon_key = ? WHERE name = 'Debate Club'", [custom]);
      await attach_demo_club_icons({ pool, cover_dir: dir, log: null });
      assert.equal(await count("SELECT COUNT(*) AS n FROM clubs WHERE icon_key = ?", [custom]), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("club photos: every demo club gets one, a second run changes nothing and an uploaded photo is never replaced", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "club-photos-"));
    try {
      const first = await attach_demo_club_photos({ pool, cover_dir: dir, now: new Date("2026-11-16T04:00:00Z"), log: null });
      assert.deepEqual(first, { attached: CLUBS.length, already: 0, missing: 0 });
      assert.equal(await count("SELECT COUNT(*) AS n FROM clubs WHERE photo_key IS NULL OR photo_alt IS NULL"), 0);
      assert.equal((await readdir(dir)).filter((name) => name.includes(".photo.")).length, CLUBS.length * 2);
      assert.equal(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'club.photo_set' AND actor_user_id IS NOT NULL"), CLUBS.length);
      const again = await attach_demo_club_photos({ pool, cover_dir: dir, log: null });
      assert.deepEqual(again, { attached: 0, already: CLUBS.length, missing: 0 });
      assert.equal((await readdir(dir)).length, CLUBS.length * 2, "no extra files written");
      const custom = "d".repeat(32);
      await db.admin.query("UPDATE clubs SET photo_key = NULL WHERE name = 'Debate Club'");
      await db.admin.query("UPDATE clubs SET photo_key = ? WHERE name = 'Film Society'", [custom]);
      const third = await attach_demo_club_photos({ pool, cover_dir: dir, log: null });
      assert.deepEqual(third, { attached: 1, already: CLUBS.length - 1, missing: 0 });
      assert.equal(await count("SELECT COUNT(*) AS n FROM clubs WHERE photo_key = ?", [custom]), 1, "the existing photo stays");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
