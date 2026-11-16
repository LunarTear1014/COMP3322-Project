import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";
import { with_transaction } from "../db/transaction.js";
import { heartbeat } from "../worker.js";
import { maintenance, run_job, run_once, scan_digests, scan_reminders } from "./handlers.js";
import { MAX_ATTEMPTS, claim_due, complete, enqueue, fail, requeue_failed } from "./queue.js";

const { skip } = test_db_config();
let app;
let ids;
let day = 3;
const T0 = new Date("2026-11-16T00:00:00Z");
const fresh = (over = {}) => published_event(app, ids, { date: future_date(app, (day += 1)), ...over });
const join = (client, event) => client.post(`/events/${event.id}/registration`, { allow_waitlist: true });
const job = async (id) => (await app.admin.query("SELECT * FROM notification_jobs WHERE id = ?", [id]))[0][0];
const reminders = async (event, user) => Number((await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE type = 'event_reminder' AND event_id = ?" + (user ? " AND user_id = ?" : ""), user ? [event.id, user] : [event.id]))[0][0].n);

describe("background jobs", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("an enqueue inside a rolled-back transaction leaves no orphan job; duplicates are ignored", async () => {
    await assert.rejects(() => with_transaction(app.pool, async (conn) => {
      await enqueue(conn, { action_key: "rollback:1", type: "event_reminder", payload: {}, now: T0 });
      throw new Error("source failed");
    }), /source failed/);
    assert.equal((await app.admin.query("SELECT COUNT(*) AS n FROM notification_jobs WHERE action_key = 'rollback:1'"))[0][0].n, 0);
    assert.equal(await enqueue(app.pool, { action_key: "dup:1", type: "event_reminder", payload: {}, now: T0 }), true);
    assert.equal(await enqueue(app.pool, { action_key: "dup:1", type: "event_reminder", payload: {}, now: T0 }), false);
  });

  test("claims take a lease token, are exclusive between workers (R7), and acknowledgement is fenced", async () => {
    await enqueue(app.pool, { action_key: "lease:1", type: "event_reminder", payload: { event_id: 0 }, now: T0 });
    const [a, b] = await Promise.all([claim_due(app.pool, { now: T0, limit: 5 }), claim_due(app.pool, { now: T0, limit: 5 })]);
    const mine = [...a, ...b].filter((j) => j.action_key === "lease:1");
    assert.equal(mine.length, 1, "only one worker owns the job");
    const claimed = mine[0];
    assert.equal(claimed.attempts, 1);
    // The first worker stalls past the 120 s lease; a second worker reclaims it.
    const later = new Date(T0.getTime() + 121_000);
    const reclaimed = (await claim_due(app.pool, { now: later, limit: 5 })).find((j) => j.action_key === "lease:1");
    assert.equal(reclaimed.attempts, 2);
    assert.notEqual(reclaimed.lock_token, claimed.lock_token);
    // The stale worker cannot acknowledge, and rolls its delivery back.
    const stale = await with_transaction(app.pool, (conn) => complete(conn, claimed, later));
    assert.equal(stale, false);
    assert.equal((await job(claimed.id)).status, "processing");
    assert.equal(await run_job(app.pool, claimed, later), "fenced");
    assert.equal(await run_job(app.pool, reclaimed, later), "completed");
    assert.equal((await job(claimed.id)).status, "completed");
  });

  test("failures retry after 5, 30, 120, 600 s and the fifth failure is failed with a sanitized error", async () => {
    await enqueue(app.pool, { action_key: "retry:1", type: "event_reminder", payload: {}, now: T0 });
    let now = T0;
    const delays = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const [claimed] = (await claim_due(app.pool, { now, limit: 20 })).filter((j) => j.action_key === "retry:1");
      assert.equal(claimed.attempts, attempt);
      await fail(app.pool, claimed, new Error(`boom\npassword=${"x".repeat(2000)}`), now);
      const row = await job(claimed.id);
      if (attempt < MAX_ATTEMPTS) { assert.equal(row.status, "pending"); delays.push((new Date(`${row.due_at.replace(" ", "T")}Z`) - now) / 1000); now = new Date(`${row.due_at.replace(" ", "T")}Z`); }
      else {
        assert.equal(row.status, "failed");
        assert.ok(row.last_error.length <= 1000 && !row.last_error.includes("\n"));
      }
    }
    assert.deepEqual(delays, [5, 30, 120, 600]);
    const failed = (await app.admin.query("SELECT COUNT(*) AS n FROM notification_jobs WHERE status = 'failed'"))[0][0];
    assert.ok(Number(failed.n) >= 1, "failed jobs are visible to the operator");
    const row = (await app.admin.query("SELECT id FROM notification_jobs WHERE action_key = 'retry:1'"))[0][0];
    assert.equal(await requeue_failed(app.pool, row.id, { now }), true);
    const reset = await job(row.id);
    assert.deepEqual([reset.status, reset.attempts, reset.last_error], ["pending", 0, null]);
    assert.equal((await app.admin.query("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'job.requeued'"))[0][0].n, 1);
  });

  test("an expired lease on the fifth attempt becomes failed and never attempt six", async () => {
    await app.admin.query("INSERT INTO notification_jobs (action_key, type, payload, status, due_at, attempts, lock_token, locked_until, created_at) VALUES ('last:1', 'event_reminder', '{}', 'processing', ?, 5, UUID(), ?, ?)", ["2026-11-16 00:00:00", "2026-11-16 00:01:00", "2026-11-16 00:00:00"]);
    const claimed = await claim_due(app.pool, { now: new Date(T0.getTime() + 600_000), limit: 20 });
    assert.equal(claimed.some((j) => j.action_key === "last:1"), false);
    const row = (await app.admin.query("SELECT * FROM notification_jobs WHERE action_key = 'last:1'"))[0][0];
    assert.deepEqual([row.status, row.attempts, row.last_error], ["failed", 5, "lease_expired_last_attempt"]);
  });

  test("reminders: 24 h boundary, one per event and user, current joined only, nothing after start or cancel (R9)", async () => {
    const event = await fresh();
    const [s1, s2, s3] = await Promise.all(["s1", "s2", "s3"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event); await join(s3, event);
    await s3.delete(`/events/${event.id}/registration`);
    const start = new Date(event.start_at);
    assert.equal((await scan_reminders(app.pool, new Date(start.getTime() - 25 * 3_600_000))) >= 0, true);
    assert.equal((await app.admin.query("SELECT COUNT(*) AS n FROM notification_jobs WHERE action_key = ?", [`reminder-event:${event.id}`]))[0][0].n, 0, "more than 24 h away: no job");
    const inside = new Date(start.getTime() - 24 * 3_600_000);
    await scan_reminders(app.pool, inside);
    await scan_reminders(app.pool, new Date(inside.getTime() + 60_000));
    assert.equal(Number((await app.admin.query("SELECT COUNT(*) AS n FROM notification_jobs WHERE action_key = ?", [`reminder-event:${event.id}`]))[0][0].n), 1, "scanner is idempotent");
    await run_once(app.pool, new Date(inside.getTime() + 61_000), { limit: 50 });
    assert.equal(await reminders(event), 2, "s1 and s2 only; s3 left");
    await run_once(app.pool, new Date(inside.getTime() + 62_000), { limit: 50 });
    assert.equal(await reminders(event), 2, "replays are harmless");
    // R9: cancellation wins over a not-yet-delivered reminder.
    const other = await fresh();
    await join(s1, other);
    const when = new Date(new Date(other.start_at).getTime() - 23 * 3_600_000);
    await scan_reminders(app.pool, when);
    const pres = await app.client_for("pres@x.test");
    await pres.post(`/events/${other.id}/cancel`, { expected_version: other.version, reason: "Weather" });
    await run_once(app.pool, new Date(when.getTime() + 1000), { limit: 50 });
    assert.equal(await reminders(other), 0);
    // Started events never remind.
    const late = await fresh();
    await join(s1, late);
    await app.admin.query("INSERT INTO notification_jobs (action_key, type, event_id, payload, status, due_at, created_at) VALUES (?, 'event_reminder', ?, ?, 'pending', '2026-11-16 00:00:00', '2026-11-16 00:00:00')", [`reminder-event:${late.id}`, late.id, JSON.stringify({ event_id: late.id })]);
    await run_once(app.pool, new Date(new Date(late.start_at).getTime() + 1000), { limit: 50 });
    assert.equal(await reminders(late), 0);
  });

  test("late joins and promotions inside 24 h get a reminder that shares the visible key with the event job", async () => {
    app.set_now(new Date("2026-11-16T00:00:00Z"));
    const date = future_date(app, 0);
    const event = await published_event(app, ids, { date, capacity: 1 });
    const [s1, s2] = await Promise.all(["s1", "s2"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event);
    const jobs = (await app.admin.query("SELECT action_key FROM notification_jobs WHERE event_id = ? ORDER BY id", [event.id]))[0].map((r) => r.action_key);
    assert.deepEqual(jobs, [`reminder-user:${event.id}:${ids.s1}`], "joined inside the window; the waitlisted student has none yet");
    await s1.delete(`/events/${event.id}/registration`);
    const after_promotion = (await app.admin.query("SELECT action_key FROM notification_jobs WHERE event_id = ? ORDER BY id", [event.id]))[0].map((r) => r.action_key);
    assert.ok(after_promotion.includes(`reminder-user:${event.id}:${ids.s2}`), "promotion inside 24 h schedules a reminder");
    const now = new Date(Date.parse(event.start_at) - 3_600_000);
    await scan_reminders(app.pool, now);
    await run_once(app.pool, now, { limit: 50 });
    assert.equal(await reminders(event, ids.s1), 0, "s1 left before delivery");
    assert.equal(await reminders(event, ids.s2), 1, "event job and user job produce one message");
    // Leave and rejoin does not create another reminder for the same event and user.
    await s2.delete(`/events/${event.id}/registration`);
    await join(s2, event);
    await run_once(app.pool, new Date(now.getTime() + 1000), { limit: 50 });
    assert.equal(await reminders(event, ids.s2), 1);
    app.set_now(T0);
  });

  test("after downtime, future events catch up while started events do not", async () => {
    const soon = await fresh();
    const gone = await fresh();
    const s1 = await app.client_for("s1@x.test");
    await join(s1, soon); await join(s1, gone);
    const back = new Date(new Date(soon.start_at).getTime() - 5 * 60_000);
    await scan_reminders(app.pool, back);
    assert.equal(Number((await app.admin.query("SELECT COUNT(*) AS n FROM notification_jobs WHERE action_key = ?", [`reminder-event:${soon.id}`]))[0][0].n), 1);
    const over = new Date(new Date(gone.start_at).getTime() + 5 * 60_000);
    await scan_reminders(app.pool, over);
    assert.equal(Number((await app.admin.query("SELECT COUNT(*) AS n FROM notification_jobs WHERE action_key = ?", [`reminder-event:${gone.id}`]))[0][0].n), 0);
  });

  test("a crash after the domain change but before delivery loses nothing (R8): the intent survives and is delivered once", async () => {
    const event = await fresh();
    const s1 = await app.client_for("s1@x.test");
    await join(s1, event);
    const start = new Date(event.start_at);
    await scan_reminders(app.pool, new Date(start.getTime() - 3_600_000));
    // "Crash": the worker claimed the job and died. The lease expires and another worker finishes it.
    const claimed = await claim_due(app.pool, { now: new Date(start.getTime() - 3_600_000), limit: 100 });
    assert.ok(claimed.some((j) => j.action_key === `reminder-event:${event.id}`));
    const resumed = new Date(start.getTime() - 3_600_000 + 130_000);
    await run_once(app.pool, resumed, { limit: 100 });
    await run_once(app.pool, new Date(resumed.getTime() + 1000), { limit: 100 });
    assert.equal(await reminders(event, ids.s1), 1);
  });

  test("daily digest: 09:00 campus time, only with activity, once per club and day, with catch-up", async () => {
    await app.admin.query("DELETE FROM participation_history; DELETE FROM audit_logs; DELETE FROM activity_digests; DELETE FROM notification_jobs; DELETE FROM notifications");
    const event = await fresh();
    const yesterday = new Date("2026-11-16T05:00:00Z"); // 13:00 HKT
    app.set_now(yesterday);
    const [s1, s2] = await Promise.all(["s1", "s2"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event);
    await s2.delete(`/events/${event.id}/registration`);
    const mem = await app.client_for("mem@x.test");
    await mem.delete("/clubs/1/membership");
    const before_nine = new Date("2026-11-17T00:30:00Z"); // 08:30 HKT
    assert.equal(await scan_digests(app.pool, before_nine), 0);
    const nine = new Date("2026-11-17T01:05:00Z"); // 09:05 HKT
    assert.equal(await scan_digests(app.pool, nine), 1, "only club 1 had activity");
    assert.equal(await scan_digests(app.pool, new Date(nine.getTime() + 60_000)), 0, "no duplicate job");
    await run_once(app.pool, nine, { limit: 10 });
    const sent = (await app.admin.query("SELECT user_id, body FROM notifications WHERE type = 'activity_digest'"))[0];
    assert.deepEqual(sent.map((r) => r.user_id).sort(), [ids.pres, ids.comm, ids.admin_c].sort());
    assert.match(sent[0].body, /2 joined, 1 left, 0 new members, 1 left the club/);
    assert.equal(await scan_digests(app.pool, new Date("2026-11-17T09:00:00Z")), 0, "already sent");
    // The worker was down: a later start still delivers the missed day.
    await app.admin.query("DELETE FROM activity_digests; DELETE FROM notification_jobs");
    assert.equal(await scan_digests(app.pool, new Date("2026-11-18T03:00:00Z")), 1, "catch-up within 3 days");
    app.set_now(T0);
  });

  test("maintenance purges views older than 180 days; the heartbeat is recorded", async () => {
    await app.admin.query("INSERT INTO event_views (event_id, user_id, source, viewed_at, bucket) SELECT id, ?, 'other', '2026-01-01 00:00:00', '2026-01-01 00:00:00' FROM events LIMIT 1", [ids.s4]);
    const result = await maintenance(app.pool, T0);
    assert.ok(result.views_purged >= 1);
    await heartbeat(app.pool, "w-test", T0);
    assert.equal((await app.admin.query("SELECT worker_id FROM worker_heartbeats WHERE worker_id = 'w-test'"))[0].length, 1);
  });
});
