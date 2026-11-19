import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { create_utc_pool } from "../db/pool.js";
import { create_password_hasher } from "../features/users/password_hasher.js";
import { prepare_database, test_db_config } from "../../test/db_helper.js";
import { attach_demo_club_icons } from "./demo_club_icons.js";
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
});
