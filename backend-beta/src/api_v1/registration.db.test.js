import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";

const { skip } = test_db_config();
let app;
let ids;
let day = 3;

const join = (client, event, allow = true) => client.post(`/events/${event.id}/registration`, { allow_waitlist: allow });
const fresh = (over = {}) => published_event(app, ids, { date: future_date(app, (day += 1)), ...over });
const rows = async (event) => (await app.admin.query("SELECT u.name, p.status FROM participations p JOIN users u ON u.id = p.user_id WHERE event_id = ? ORDER BY p.last_registered_at, p.user_id", [event.id]))[0].map((r) => `${r.name}:${r.status}`);

describe("v1 registration, waitlist and participants", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("registering persists across sessions and a repeat changes nothing", async () => {
    const event = await fresh();
    const first = await app.client_for("s1@x.test");
    const created = await join(first, event);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.data, { event_id: event.id, status: "joined", queue_position: null, joined_count: 1, waitlisted_count: 0 });
    const [[h1]] = await app.admin.query("SELECT COUNT(*) AS n FROM participation_history WHERE event_id = ?", [event.id]);
    const again = await join(first, event);
    assert.equal(again.status, 200);
    const [[h2]] = await app.admin.query("SELECT COUNT(*) AS n FROM participation_history WHERE event_id = ?", [event.id]);
    assert.equal(Number(h2.n), Number(h1.n), "no new history");
    const other_session = await app.client_for("s1@x.test");
    assert.equal((await other_session.get(`/events/${event.id}`)).body.data.my_registration.status, "joined");
    const mine = (await other_session.get("/me/registrations")).body.data;
    assert.equal(mine[0].status, "joined");
    assert.equal(mine[0].event.id, event.id);
    const [[n]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'registration_changed'", [ids.s1]);
    assert.equal(Number(n.n), 1, "one confirmation, not two");
  });

  test("final seat race: exactly one joins, the other is queued or told it is full (R2)", async () => {
    const event = await fresh({ capacity: 1 });
    const [a, b] = await Promise.all([app.client_for("s1@x.test"), app.client_for("s2@x.test")]);
    const results = await Promise.all([join(a, event), join(b, event)]);
    assert.deepEqual(results.map((r) => r.status), [201, 201]);
    assert.deepEqual(results.map((r) => r.body.data.status).sort(), ["joined", "waitlisted"]);
    const [[{ joined }]] = await app.admin.query("SELECT COUNT(*) AS joined FROM participations WHERE event_id = ? AND status = 'joined'", [event.id]);
    assert.equal(Number(joined), 1);
    const c = await app.client_for("s3@x.test");
    assert.equal((await join(c, event, false)).body.error.code, "EVENT_FULL");
  });

  test("withdrawal promotes the earliest waiter first; a left user rejoins at the tail", async () => {
    const event = await fresh({ capacity: 1 });
    const [s1, s2, s3, s4] = await Promise.all(["s1", "s2", "s3", "s4"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event); await join(s3, event);
    assert.equal((await s3.get(`/events/${event.id}`)).body.data.my_registration.queue_position, 2);
    const left = await s1.delete(`/events/${event.id}/registration`);
    assert.equal(left.body.data.status, "left");
    assert.deepEqual(await rows(event), ["s1:left", "s2:joined", "s3:waitlisted"]);
    assert.equal((await s3.get(`/events/${event.id}`)).body.data.my_registration.queue_position, 1);
    await join(s1, event);
    assert.equal((await s1.get(`/events/${event.id}`)).body.data.my_registration.queue_position, 2, "rejoin goes to the tail");
    const [[promo]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND event_id = ? AND title LIKE 'You got a seat%'", [ids.s2, event.id]);
    assert.equal(Number(promo.n), 1);
    // Leaving the waitlist only removes that entry.
    await s3.delete(`/events/${event.id}/registration`);
    assert.equal((await s1.get(`/events/${event.id}`)).body.data.my_registration.queue_position, 1);
    assert.equal((await s4.delete(`/events/${event.id}/registration`)).status, 404, "never registered");
  });

  test("withdrawal and a new arrival race: the earlier waiter gets the seat, the arrival cannot jump (R3)", async () => {
    const event = await fresh({ capacity: 1 });
    const [s1, s2, s3, s4] = await Promise.all(["s1", "s2", "s3", "s4"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event);
    await Promise.all([s1.delete(`/events/${event.id}/registration`), join(s3, event), join(s4, event)]);
    const state = await rows(event);
    assert.ok(state.includes("s2:joined"), state.join());
    assert.equal(state.filter((r) => r.endsWith(":joined")).length, 1);
  });

  test("members-only events require membership and block leaving the club while registered (R5)", async () => {
    const event = await fresh({ visibility: "members_only" });
    const outsider = await app.client_for("s1@x.test");
    assert.equal((await join(outsider, event)).body.error.code, "MEMBERSHIP_REQUIRED");
    assert.equal((await outsider.get(`/events/${event.id}`)).body.data.eligibility.reason, "MEMBERSHIP_REQUIRED");
    const mem = await app.client_for("mem@x.test");
    const asked = await join(mem, event);
    assert.equal(asked.status, 202, "plain members ask the committee first");
    assert.equal(asked.body.data.status, "requested");
    const comm = await app.client_for("comm@x.test");
    assert.equal((await comm.post(`/events/${event.id}/join-requests/${ids.mem}/decision`, { decision: "accept" })).body.data.status, "joined");
    const leave = await mem.delete("/clubs/1/membership");
    assert.equal(leave.body.error.code, "ACTIVE_MEMBER_REGISTRATIONS");
    await mem.delete(`/events/${event.id}/registration`);
    // R5: leaving races registering; the invariant is "no non-member with an active registration".
    const racer = await app.client_for("s2@x.test");
    await app.admin.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, 1, 'member')", [ids.s2]);
    const [l, j] = await Promise.all([racer.delete("/clubs/1/membership"), join(racer, event)]);
    const [[bad]] = await app.admin.query(
      `SELECT COUNT(*) AS n FROM participations p JOIN events e ON e.id = p.event_id
       WHERE e.id = ? AND p.user_id = ? AND p.status IN ('joined', 'waitlisted') AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = p.user_id AND m.club_id = e.club_id)`, [event.id, ids.s2]);
    assert.equal(Number(bad.n), 0, `statuses ${l.status}/${j.status}`);
    await app.admin.query("DELETE FROM memberships WHERE user_id = ? AND club_id = 1", [ids.s2]);
  });

  test("public events do not block leaving; committee and presidents cannot leave", async () => {
    await fresh();
    const mem = await app.client_for("mem@x.test");
    assert.equal((await mem.delete("/clubs/1/membership")).status, 204);
    assert.equal((await mem.delete("/clubs/1/membership")).status, 204, "absent is idempotent");
    const asked = await mem.put("/clubs/1/membership", {});
    assert.equal(asked.status, 202, "rejoining asks the committee");
    assert.equal(asked.body.data.status, "pending");
    const again = await mem.put("/clubs/1/membership", {});
    assert.equal(again.status, 200);
    assert.equal(again.body.data.id, asked.body.data.id, "one pending request, not two");
    const comm = await app.client_for("comm@x.test");
    assert.equal((await comm.post(`/clubs/1/join-requests/${asked.body.data.id}/review`, { decision: "accept" })).body.data.status, "accepted");
    assert.equal((await mem.put("/clubs/1/membership", {})).body.data.role, "member");
    assert.equal((await comm.delete("/clubs/1/membership")).body.error.code, "COMMITTEE_MEMBERSHIP_PROTECTED");
    assert.equal((await comm.put("/clubs/1/membership", {})).body.data.role, "committee", "never downgraded");
    const pres = await app.client_for("pres@x.test");
    assert.equal((await pres.delete("/clubs/1/membership")).body.error.code, "PRESIDENT_TRANSFER_REQUIRED");
  });

  test("deadline equality closes registration but withdrawal stays possible until start", async () => {
    const date = future_date(app, (day += 1));
    const event = await published_event(app, ids, { date, registration_closes_at: `${date}T00:00:00Z` });
    const s1 = await app.client_for("s1@x.test");
    await join(s1, event);
    app.set_now(new Date(event.registration_closes_at));
    const s2 = await app.client_for("s2@x.test");
    assert.equal((await join(s2, event)).body.error.code, "REGISTRATION_CLOSED");
    assert.equal((await s1.delete(`/events/${event.id}/registration`)).body.data.status, "left");
    app.set_now(new Date(event.start_at));
    const joined_again = await join(s1, event);
    assert.equal(joined_again.status, 409);
    app.set_now(new Date("2026-11-16T00:00:00Z"));
  });

  test("promotion skips an ineligible legacy waiter and removes them with a reason", async () => {
    const event = await fresh({ capacity: 1, visibility: "members_only" });
    const mem = await app.client_for("mem@x.test");
    const comm = await app.client_for("comm@x.test");
    await join(comm, event);
    await join(mem, event);
    // Members-only: the committee accepts the member onto the waitlist.
    assert.equal((await comm.post(`/events/${event.id}/join-requests/${ids.mem}/decision`, { decision: "accept" })).body.data.status, "waitlisted");
    await app.admin.query("INSERT INTO participations (user_id, event_id, status, last_registered_at, queued_at) VALUES (?, ?, 'waitlisted', '2026-11-15 00:00:00', '2026-11-15 00:00:00')", [ids.s1, event.id]);
    await comm.delete(`/events/${event.id}/registration`);
    const state = await rows(event);
    assert.ok(state.includes("s1:left"), state.join());
    assert.ok(state.includes("mem:joined"), "the next eligible waiter was promoted");
    const [hist] = await app.admin.query("SELECT user_id FROM participation_history WHERE event_id = ? AND reason = 'membership_ineligible'", [event.id]);
    assert.deepEqual(hist.map((h) => h.user_id), [ids.s1]);
  });

  test("participants are committee-only, filtered and ordered; students cannot list them", async () => {
    const event = await fresh({ capacity: 1 });
    const [s1, s2, s3] = await Promise.all(["s1", "s2", "s3"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event); await join(s3, event);
    const comm = await app.client_for("comm@x.test");
    const admin = await app.client_for("admin@x.test");
    const waiting = await comm.get(`/events/${event.id}/participants?status=waitlisted`);
    assert.deepEqual(waiting.body.data.map((p) => [p.user.name, p.queue_position]), [["s2", 1], ["s3", 2]]);
    assert.equal((await comm.get(`/events/${event.id}/participants`)).body.data[0].user.email, "s1@x.test");
    assert.equal((await s1.get(`/events/${event.id}/participants`)).status, 403);
    assert.equal((await admin.get(`/events/${event.id}/participants`)).status, 403, "admin role alone does not expose identities");
    assert.equal((await comm.get(`/events/${event.id}/participants?status=bogus`)).status, 422);
    const hist = (await app.admin.query("SELECT action FROM participation_history WHERE event_id = ? ORDER BY id", [event.id]))[0].map((h) => h.action);
    assert.deepEqual(hist, ["joined", "waitlisted", "waitlisted"], "only actual transitions are recorded");
  });

  test("a hidden draft cannot be registered for and gives no existence oracle", async () => {
    const pres = await app.client_for("pres@x.test");
    const draft = (await pres.post("/events", { club_id: 1, venue_id: 1, title: "Secret", description: "d", date: future_date(app, 60), slot_id: "morning", visibility: "public", capacity: 2, campus_tag_ids: [app.campus_tag_id] })).body.data;
    const s1 = await app.client_for("s1@x.test");
    assert.equal((await join(s1, draft)).status, 404);
    assert.equal((await s1.get("/events/999999")).status, 404);
    assert.equal((await s1.get("/events/abc")).status, 404);
  });
});
