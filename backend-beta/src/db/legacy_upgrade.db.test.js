import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { prepare_database, test_db_config } from "../../test/db_helper.js";

// Upgrades a populated beta database (legacy local-time DATETIME values).
const { skip } = test_db_config();
let db;
afterEach(async () => { delete process.env.LEGACY_DATETIME_TIMEZONE; await db?.close(); db = null; });

async function legacy_rows(admin) {
  await admin.query(`
    INSERT INTO users (id, email, password_hash, name, student_id) VALUES (1, 'a@t.test', 'x', 'A', 's1'), (2, 'b@t.test', 'x', 'B', 's2');
    INSERT INTO clubs (id, name) VALUES (1, 'Club');
    INSERT INTO venues (id, name, location, capacity) VALUES (1, 'Hall', 'L1', 50);
    INSERT INTO bookings (id, venue_id, club_id, start_time, end_time, status) VALUES (1, 1, 1, '2026-11-20 13:00:00', '2026-11-20 15:00:00', 'confirmed');
    INSERT INTO events (id, booking_id, club_id, title, start_time, end_time, capacity) VALUES (1, 1, 1, 'E', '2026-11-20 13:00:00', '2026-11-20 15:00:00', 10);
    INSERT INTO participations (user_id, event_id, status) VALUES (1, 1, 'joined'), (2, 1, 'pending');`);
}
const times = async (admin) => (await admin.query("SELECT b.start_time AS b, e.start_time AS e, e.registration_closes_at AS c FROM bookings b JOIN events e ON e.booking_id = b.id"))[0][0];

describe("upgrade of a populated beta database", { skip }, () => {
  test("Asia/Taipei local times become UTC once, with legacy defaults and IDs preserved", async () => {
    db = await prepare_database({ migrate: false });
    await legacy_rows(db.admin);
    process.env.LEGACY_DATETIME_TIMEZONE = "Asia/Taipei";
    const first = await db.migrate();
    assert.ok(first.applied.includes("004_backfill_utc"));
    assert.deepEqual(await times(db.admin), { b: "2026-11-20 05:00:00.000000", e: "2026-11-20 05:00:00.000000", c: "2026-11-20 05:00:00.000000" });
    assert.deepEqual((await db.migrate()).applied, []);
    assert.equal((await times(db.admin)).b, "2026-11-20 05:00:00.000000", "a rerun must not shift again");
    const [counts] = await db.admin.query("SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM events) e, (SELECT COUNT(*) FROM participations) p, (SELECT MAX(id) FROM bookings) b");
    assert.deepEqual({ ...counts[0] }, { u: 2, e: 1, p: 2, b: 1 });
    const [parts] = await db.admin.query("SELECT user_id, status, last_registered_at IS NOT NULL AS lr, confirmed_at IS NOT NULL AS c, queued_at IS NOT NULL AS q FROM participations ORDER BY user_id");
    assert.deepEqual(parts.map((p) => ({ ...p })), [{ user_id: 1, status: "joined", lr: 1, c: 1, q: 0 }, { user_id: 2, status: "pending", lr: 1, c: 0, q: 1 }]);
    const [meta] = await db.admin.query("SELECT metadata_key k, metadata_value v FROM schema_metadata WHERE metadata_key IN ('legacy_times_utc', 'history_complete_from') ORDER BY k");
    assert.equal(meta.length, 2);
    assert.equal(meta[1].v, "Asia/Taipei");
    const [[actors]] = await db.admin.query("SELECT requested_by, decided_by FROM bookings");
    assert.deepEqual({ ...actors }, { requested_by: null, decided_by: null });
  });

  test("an already-UTC dataset is not shifted", async () => {
    db = await prepare_database({ migrate: false });
    await legacy_rows(db.admin);
    process.env.LEGACY_DATETIME_TIMEZONE = "UTC";
    await db.migrate();
    assert.equal((await times(db.admin)).b, "2026-11-20 13:00:00.000000");
  });

  test("an interrupted run after the shift marker never double-shifts", async () => {
    db = await prepare_database({ migrate: false });
    await legacy_rows(db.admin);
    process.env.LEGACY_DATETIME_TIMEZONE = "Asia/Taipei";
    await db.migrate();
    // Simulate a crash before 004 was recorded: remove the version row, keep the marker.
    await db.admin.query("DELETE FROM schema_migrations WHERE version = '004_backfill_utc'");
    await db.migrate();
    assert.equal((await times(db.admin)).b, "2026-11-20 05:00:00.000000");
  });

  test("a populated database without the timezone confirmation refuses to migrate", async () => {
    db = await prepare_database({ migrate: false });
    await legacy_rows(db.admin);
    await assert.rejects(() => db.migrate(), (error) => error.code === "PREFLIGHT_FAILED" && /LEGACY_DATETIME_TIMEZONE/.test(error.message));
    assert.equal((await times(db.admin)).b, "2026-11-20 13:00:00", "nothing was changed");
  });

  test("preflight refuses overlaps, mismatches, oversized capacity and colliding identities", async () => {
    db = await prepare_database({ migrate: false });
    await legacy_rows(db.admin);
    await db.admin.query(`
      INSERT INTO users (id, email, password_hash, name, student_id) VALUES (3, ' A@T.test', 'x', 'C', ' S1');
      INSERT INTO bookings (id, venue_id, club_id, start_time, end_time, status) VALUES (2, 1, 1, '2026-11-20 14:00:00', '2026-11-20 16:00:00', 'confirmed');
      INSERT INTO events (id, booking_id, club_id, title, start_time, end_time, capacity) VALUES (2, 2, 1, 'Mismatch', '2026-11-20 14:00:00', '2026-11-20 17:00:00', 99);`);
    process.env.LEGACY_DATETIME_TIMEZONE = "Asia/Taipei";
    await assert.rejects(() => db.migrate(), (error) => error.code === "PREFLIGHT_FAILED"
      && ["overlap", "times differ", "capacity above venue", "emails that collide", "student IDs that collide"].every((word) => error.message.includes(word)));
  });
});
