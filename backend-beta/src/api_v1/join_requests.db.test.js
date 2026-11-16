import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";

// Committee approval of club membership and of members-only registration
// (identity-membership "Club membership requests", event-participation
// "Members-only registration approval").

const { skip } = test_db_config();
let app;
let ids;
let day = 3;

const join = (client, event, allow = true) => client.post(`/events/${event.id}/registration`, { allow_waitlist: allow });
const fresh = (over = {}) => published_event(app, ids, { date: future_date(app, (day += 1)), visibility: "members_only", ...over });
const inbox = async (user_id, type) => (await app.admin.query(
  "SELECT id, club_id, club_join_request_id, event_id, title FROM notifications WHERE user_id = ? AND type = ? ORDER BY id", [user_id, type]))[0];
const add_member = (user_id) => app.admin.query("INSERT IGNORE INTO memberships (user_id, club_id, role) VALUES (?, 1, 'member')", [user_id]);

describe("v1 join requests", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("a club join request waits for the committee, and only one reviewer can decide it", async () => {
    const s3 = await app.client_for("s3@x.test");
    const asked = await s3.put("/clubs/1/membership", {});
    assert.equal(asked.status, 202);
    assert.deepEqual(Object.keys(asked.body.data).sort(), ["club_id", "id", "status"]);
    const club = (await s3.get("/clubs")).body.data.find((row) => row.id === 1);
    assert.equal(club.request_status, "pending");
    assert.equal(club.my_role, null);

    // Committee and president hear about it immediately, with the request id the inbox buttons need.
    const [note] = await inbox(ids.comm, "club_join_request");
    assert.equal(note.club_join_request_id, asked.body.data.id);
    assert.equal((await inbox(ids.pres, "club_join_request")).length, 1);
    const comm = await app.client_for("comm@x.test");
    const listed = (await comm.get("/notifications")).body.data.find((row) => row.type === "club_join_request");
    assert.equal(listed.join_request_id, asked.body.data.id);
    assert.equal(listed.club_id, 1);

    const mem = await app.client_for("mem@x.test");
    assert.equal((await mem.get("/clubs/1/join-requests")).status, 403, "plain members can't review");
    assert.equal((await s3.get("/clubs/1/join-requests")).status, 404, "outsiders don't learn about the club's queue");
    const queue = (await comm.get("/clubs/1/join-requests")).body;
    assert.equal(queue.meta.total, 1);
    assert.equal(queue.data[0].user.id, ids.s3);

    const pres = await app.client_for("pres@x.test");
    const [a, b] = await Promise.all([
      comm.post(`/clubs/1/join-requests/${asked.body.data.id}/review`, { decision: "accept" }),
      pres.post(`/clubs/1/join-requests/${asked.body.data.id}/review`, { decision: "reject" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const accepted = a.status === 200;
    const [[member]] = await app.admin.query("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ? AND club_id = 1", [ids.s3]);
    assert.equal(Number(member.n), accepted ? 1 : 0);
    assert.equal((await inbox(ids.comm, "club_join_request")).length, 0, "stale review buttons are removed");
    assert.equal((await inbox(ids.s3, "club_membership")).length, 1);
    assert.equal((await comm.post("/clubs/1/join-requests/999999/review", { decision: "accept" })).status, 404);
    assert.equal((await comm.post(`/clubs/1/join-requests/${asked.body.data.id}/review`, { decision: "maybe" })).status, 422);
    await app.admin.query("DELETE FROM memberships WHERE user_id = ? AND club_id = 1", [ids.s3]);
  });

  test("accepting a club request writes member.joined for the daily digest", async () => {
    const s4 = await app.client_for("s4@x.test");
    const asked = (await s4.put("/clubs/1/membership", {})).body.data;
    const comm = await app.client_for("comm@x.test");
    assert.equal((await comm.post(`/clubs/1/join-requests/${asked.id}/review`, { decision: "accept" })).body.data.status, "accepted");
    assert.equal((await s4.get("/me/memberships")).body.data[0].role, "member");
    const [[{ n }]] = await app.admin.query(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = 'membership' AND entity_id = 1 AND action = 'member.joined' AND JSON_EXTRACT(details, '$.user_id') = ?", [ids.s4]);
    assert.equal(Number(n), 1);
    await app.admin.query("DELETE FROM memberships WHERE user_id = ? AND club_id = 1", [ids.s4]);
  });

  test("members ask to join members-only events; committee members register directly", async () => {
    const event = await fresh({ capacity: 1 });
    const mem = await app.client_for("mem@x.test");
    const asked = await join(mem, event, false);
    assert.equal(asked.status, 202);
    assert.equal(asked.body.data.status, "requested");
    assert.equal(asked.body.data.joined_count, 0, "nothing is allocated yet");
    assert.equal((await join(mem, event)).status, 200, "repeat keeps the one request");
    const seen = (await mem.get(`/events/${event.id}`)).body.data;
    assert.equal(seen.my_registration.status, "requested");
    assert.equal(seen.eligibility.reason, "REQUEST_PENDING");
    assert.equal((await mem.get("/me/registrations?status=requested")).body.data[0].event.id, event.id);
    assert.equal((await inbox(ids.comm, "event_join_request")).filter((row) => row.event_id === event.id).length, 1);

    // The committee member takes the only seat directly.
    const comm = await app.client_for("comm@x.test");
    assert.equal((await join(comm, event)).status, 201);
    const managed = (await comm.get(`/events/${event.id}`)).body.data;
    assert.equal(managed.pending_join_requests, 1);
    const queue = (await comm.get(`/events/${event.id}/join-requests`)).body;
    assert.deepEqual(queue.data.map((row) => [row.user.id, row.allow_waitlist]), [[ids.mem, false]]);

    // Full, and the student didn't consent to the waitlist: the request stays pending.
    const full = await comm.post(`/events/${event.id}/join-requests/${ids.mem}/decision`, { decision: "accept" });
    assert.equal(full.body.error.code, "EVENT_FULL");
    assert.equal((await mem.get(`/events/${event.id}`)).body.data.my_registration.status, "requested");

    const rejected = await comm.post(`/events/${event.id}/join-requests/${ids.mem}/decision`, { decision: "reject", reason: "Seats are for the exhibition team." });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.status, "left");
    const told = (await app.admin.query("SELECT body FROM notifications WHERE user_id = ? AND event_id = ? ORDER BY id DESC LIMIT 1", [ids.mem, event.id]))[0][0];
    assert.match(told.body, /exhibition team/);
    assert.equal((await comm.post(`/events/${event.id}/join-requests/${ids.mem}/decision`, { decision: "accept" })).body.error.code, "INVALID_STATE");
    assert.equal((await mem.get(`/events/${event.id}/join-requests`)).status, 403);
  });

  test("accepting allocates a seat or a waitlist place by the current rules", async () => {
    const event = await fresh({ capacity: 1 });
    await add_member(ids.s1);
    await add_member(ids.s2);
    const s1 = await app.client_for("s1@x.test");
    const s2 = await app.client_for("s2@x.test");
    assert.equal((await join(s1, event)).status, 202);
    assert.equal((await join(s2, event)).status, 202);
    const pres = await app.client_for("pres@x.test");
    assert.equal((await pres.post(`/events/${event.id}/join-requests/${ids.s1}/decision`, { decision: "accept" })).body.data.status, "joined");
    const second = (await pres.post(`/events/${event.id}/join-requests/${ids.s2}/decision`, { decision: "accept" })).body.data;
    assert.equal(second.status, "waitlisted");
    assert.equal(second.queue_position, 1);
    // Withdrawal of the seated student promotes the accepted waiter, as for any registration.
    assert.equal((await s1.delete(`/events/${event.id}/registration`)).body.data.status, "left");
    assert.equal((await s2.get(`/events/${event.id}`)).body.data.my_registration.status, "joined");
    await app.admin.query("DELETE FROM participations WHERE user_id IN (?, ?)", [ids.s1, ids.s2]);
  });

  test("withdrawing, leaving the club and cancelling the event close pending requests", async () => {
    await add_member(ids.s3);
    const s3 = await app.client_for("s3@x.test");
    const first = await fresh();
    await join(s3, first);
    assert.equal((await s3.delete(`/events/${first.id}/registration`)).body.data.status, "left");
    const [[a]] = await app.admin.query("SELECT status FROM event_join_requests WHERE event_id = ? AND user_id = ?", [first.id, ids.s3]);
    assert.equal(a.status, "withdrawn");
    assert.equal((await join(s3, first)).status, 202, "asking again reopens the request");

    // Leaving the club withdraws it (a request does not block leaving).
    assert.equal((await s3.delete("/clubs/1/membership")).status, 204);
    const [[b]] = await app.admin.query("SELECT status FROM event_join_requests WHERE event_id = ? AND user_id = ?", [first.id, ids.s3]);
    assert.equal(b.status, "withdrawn");

    // A request whose student left by another route is closed on accept.
    await add_member(ids.s3);
    await join(s3, first);
    await app.admin.query("DELETE FROM memberships WHERE user_id = ? AND club_id = 1", [ids.s3]);
    const comm = await app.client_for("comm@x.test");
    assert.equal((await comm.post(`/events/${first.id}/join-requests/${ids.s3}/decision`, { decision: "accept" })).body.error.code, "MEMBERSHIP_REQUIRED");
    const [[c]] = await app.admin.query("SELECT status FROM event_join_requests WHERE event_id = ? AND user_id = ?", [first.id, ids.s3]);
    assert.equal(c.status, "cancelled");

    await add_member(ids.s3);
    const second = await fresh();
    await join(s3, second);
    const pres = await app.client_for("pres@x.test");
    const cancelled = await pres.post(`/events/${second.id}/cancel`, { expected_version: second.version, reason: "Venue flooded." });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    const [[d]] = await app.admin.query("SELECT status FROM event_join_requests WHERE event_id = ? AND user_id = ?", [second.id, ids.s3]);
    assert.equal(d.status, "cancelled");
    assert.equal((await inbox(ids.s3, "event_cancelled")).filter((row) => row.event_id === second.id).length, 1);
    await app.admin.query("DELETE FROM memberships WHERE user_id = ? AND club_id = 1", [ids.s3]);
  });

  test("public events stay automatic for members", async () => {
    const event = await fresh({ visibility: "public" });
    const mem = await app.client_for("mem@x.test");
    const joined = await join(mem, event);
    assert.equal(joined.status, 201);
    assert.equal(joined.body.data.status, "joined");
  });
});
