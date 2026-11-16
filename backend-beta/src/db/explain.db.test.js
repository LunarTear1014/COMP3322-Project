import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { prepare_database, test_db_config } from "../../test/db_helper.js";

// EXPLAIN of the hot queries (task 2.5): each must use an index on its driving
// table instead of scanning it. Tables get a few rows and ANALYZE first so the
// optimizer has statistics; the check is on the access type per table.
const { skip } = test_db_config();
let db;

const PLANS = {
  "confirmed overlap": ["SELECT id FROM bookings WHERE venue_id = 1 AND status = 'confirmed' AND start_time < '2027-01-01' AND end_time > '2026-01-01'", "bookings"],
  "admin review queue": ["SELECT id FROM bookings WHERE status = 'pending' ORDER BY created_at, id LIMIT 20", "bookings"],
  "ordered waitlist": ["SELECT user_id FROM participations WHERE event_id = 1 AND status IN ('waitlisted', 'pending') ORDER BY queued_at, user_id", "participations"],
  "job claim": ["SELECT id FROM notification_jobs WHERE status = 'pending' AND due_at <= '2027-01-01' ORDER BY due_at, id LIMIT 5", "notification_jobs"],
  "reminder scan": ["SELECT id FROM events WHERE status = 'published' AND start_time > '2026-01-01' AND start_time <= '2027-01-01'", "events"],
  "inbox": ["SELECT id FROM notifications WHERE user_id = 1 ORDER BY created_at DESC, id DESC LIMIT 20", "notifications"],
  "unread count": ["SELECT COUNT(*) FROM notifications WHERE user_id = 1 AND read_at IS NULL", "notifications"],
  "history by event": ["SELECT id FROM participation_history WHERE event_id = 1 ORDER BY id", "participation_history"],
  "club events in range": ["SELECT id FROM events WHERE club_id = 1 AND status = 'published' AND start_time >= '2026-01-01' AND start_time < '2027-01-01'", "events"],
};

describe("query plans", { skip }, () => {
  before(async () => {
    db = await prepare_database();
    await db.admin.query(`INSERT INTO users (id, email, password_hash, name, student_id) VALUES (1, 'a@t.test', 'x', 'A', 's1');
      INSERT INTO clubs (id, name) VALUES (1, 'C'); INSERT INTO venues (id, name, location, capacity) VALUES (1, 'V', 'L', 50);`);
    for (let i = 1; i <= 300; i += 1) {
      await db.admin.query("INSERT INTO bookings (venue_id, club_id, start_time, end_time, status) VALUES (1, 1, DATE_ADD('2026-12-01', INTERVAL ? HOUR), DATE_ADD('2026-12-01', INTERVAL ? HOUR), ?)", [i * 3, i * 3 + 2, i % 2 ? "pending" : "confirmed"]);
    }
    await db.admin.query("INSERT INTO events (booking_id, club_id, title, start_time, end_time, status, capacity, registration_closes_at) SELECT id, 1, 'E', start_time, end_time, 'published', 5, start_time FROM bookings");
    await db.admin.query("INSERT INTO participations (user_id, event_id, status, queued_at, last_registered_at) SELECT 1, id, 'waitlisted', NOW(6), NOW(6) FROM events");
    await db.admin.query("INSERT INTO notifications (user_id, event_title, message, created_at) SELECT 1, 't', 'm', NOW() FROM events");
    await db.admin.query("INSERT INTO notification_jobs (action_key, type, payload, due_at, created_at) SELECT CONCAT('k', id), 'event_reminder', '{}', NOW(6), NOW(6) FROM events");
    await db.admin.query("INSERT INTO participation_history (event_id, user_id, action_id, action, to_status, occurred_at) SELECT id, 1, UUID(), 'joined', 'joined', NOW(6) FROM events");
    for (const table of ["bookings", "events", "participations", "notifications", "notification_jobs", "participation_history"]) await db.admin.query(`ANALYZE TABLE ${table}`);
  });
  after(async () => { await db?.close(); });

  for (const [name, [sql, table]] of Object.entries(PLANS)) {
    test(`${name} uses an index on ${table}`, async () => {
      const [plan] = await db.admin.query(`EXPLAIN ${sql}`);
      const row = plan.find((entry) => entry.table === table);
      assert.ok(row, JSON.stringify(plan));
      assert.notEqual(row.type, "ALL", `${name}: full scan of ${table} (${JSON.stringify(row)})`);
      assert.ok(row.key, `${name}: no index chosen`);
    });
  }
});
