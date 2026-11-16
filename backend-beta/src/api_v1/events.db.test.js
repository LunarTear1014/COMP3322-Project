import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, create_body, future_date, published_event } from "../../test/world.js";

const { skip } = test_db_config();
let app;
let ids;

describe("v1 booking, publication and sign-off workflow", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("a president's request becomes a pending booking plus a draft, and approval does not publish", async () => {
    const pres = await app.client_for("pres@x.test");
    const created = await pres.post("/events", create_body(app, { date: future_date(app, 10) }));
    assert.equal(created.status, 201);
    const event = created.body.data;
    assert.equal(event.state, "draft");
    assert.equal(event.booking.status, "pending");
    assert.equal(event.version, 1);
    assert.deepEqual(event.campus_tags.map((t) => t.slug), ["social"], "defaults to Social");
    assert.match(event.start_at, /T02:00:00\.000Z$/, "morning slot is 10:00 HKT");
    const admin = await app.client_for("admin@x.test");
    const approved = await admin.post(`/bookings/${event.booking.id}/decision`, { expected_version: 1, decision: "approve" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, "confirmed");
    const after_approval = await pres.get(`/events/${event.id}`);
    assert.equal(after_approval.body.data.state, "draft", "approval does not publish");
    const student = await app.client_for("s1@x.test");
    assert.equal((await student.get(`/events/${event.id}`)).status, 404, "private draft is hidden");
    assert.equal((await student.get(`/events?phase=upcoming`)).body.data.some((e) => e.id === event.id), false);
  });

  test("create validates club, venue, capacity, past dates and unknown fields", async () => {
    const pres = await app.client_for("pres@x.test");
    const mem = await app.client_for("mem@x.test");
    assert.equal((await mem.post("/events", create_body(app))).status, 403);
    assert.equal((await pres.post("/events", create_body(app, { club_id: 2 }))).status, 403);
    assert.equal((await pres.post("/events", create_body(app, { venue_id: 3 }))).status, 422);
    assert.ok((await pres.post("/events", create_body(app, { capacity: 41 }))).body.error.fields.capacity);
    assert.ok((await pres.post("/events", create_body(app, { date: future_date(app, -1) }))).body.error.fields.date);
    assert.ok((await pres.post("/events", create_body(app, { date: "2027-02-29" }))).body.error.fields.date);
    assert.ok((await pres.post("/events", { ...create_body(app), club_name: "Photo" })).body.error.fields.club_name);
    assert.ok((await pres.post("/events", create_body(app, { registration_closes_at: "2020-01-01T00:00:00Z" }))).body.error.fields.registration_closes_at);
    assert.ok((await pres.post("/events", create_body(app, { campus_tag_ids: [999] }))).body.error.fields.campus_tag_ids);
  });

  test("a failed create leaves no booking, event or tags behind", async () => {
    const pres = await app.client_for("pres@x.test");
    const [[before]] = await app.admin.query("SELECT (SELECT COUNT(*) FROM bookings) b, (SELECT COUNT(*) FROM events) e");
    await pres.post("/events", create_body(app, { date: future_date(app, 11), campus_tag_ids: [999] }));
    const [[after_]] = await app.admin.query("SELECT (SELECT COUNT(*) FROM bookings) b, (SELECT COUNT(*) FROM events) e");
    assert.deepEqual({ ...after_ }, { ...before });
  });

  test("pending requests may overlap, only one can be confirmed (R1), adjacent slots are fine", async () => {
    const date = future_date(app, 12);
    const a = await app.client_for("pres@x.test");
    const b = await app.client_for("pres2@x.test");
    const first = (await a.post("/events", create_body(app, { date }))).body.data;
    const second = (await b.post("/events", create_body(app, { date, club_id: 2 }))).body.data;
    assert.equal(first.booking.status, "pending");
    assert.equal(second.booking.status, "pending", "pending requests never hold a venue");
    const [x, y] = await Promise.all([app.client_for("admin@x.test"), app.client_for("admin_c@x.test")]);
    const results = await Promise.all([
      x.post(`/bookings/${first.booking.id}/decision`, { expected_version: 1, decision: "approve" }),
      y.post(`/bookings/${second.booking.id}/decision`, { expected_version: 1, decision: "approve" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // admin_c is on club 1's committee, so deciding club 1's request is a self-decision; club 2's is fine.
    const [[confirmed]] = await app.admin.query("SELECT COUNT(*) AS n FROM bookings WHERE venue_id = 1 AND status = 'confirmed' AND start_time = (SELECT start_time FROM bookings WHERE id = ?)", [first.booking.id]);
    assert.equal(Number(confirmed.n), 1, `exactly one confirmed (${statuses})`);
    assert.ok(results.some((r) => r.status === 409 || r.status === 403));
    const adjacent = await a.post("/events", create_body(app, { date, slot_id: "afternoon" }));
    assert.equal(adjacent.status, 201);
  });

  test("approval conflict leaves the request pending and VENUE_UNAVAILABLE is reported", async () => {
    const date = future_date(app, 14);
    const a = await app.client_for("pres@x.test");
    const b = await app.client_for("pres2@x.test");
    const admin = await app.client_for("admin@x.test");
    const one = (await a.post("/events", create_body(app, { date, slot_id: "evening" }))).body.data;
    const two = (await b.post("/events", create_body(app, { date, slot_id: "evening", club_id: 2 }))).body.data;
    assert.equal((await admin.post(`/bookings/${one.booking.id}/decision`, { expected_version: 1, decision: "approve" })).status, 200);
    const clash = await admin.post(`/bookings/${two.booking.id}/decision`, { expected_version: 1, decision: "approve" });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, "VENUE_UNAVAILABLE");
    const [[row]] = await app.admin.query("SELECT status FROM bookings WHERE id = ?", [two.booking.id]);
    assert.equal(row.status, "pending");
    const creating = await b.post("/events", create_body(app, { date, slot_id: "evening", club_id: 2 }));
    assert.equal(creating.body.error.code, "VENUE_UNAVAILABLE", "new requests cannot be created on a confirmed slot");
  });

  test("decisions need versions, reasons and a non-self admin; stale and repeated decisions conflict", async () => {
    const pres = await app.client_for("pres@x.test");
    const admin = await app.client_for("admin@x.test");
    const adminc = await app.client_for("admin_c@x.test");
    const event = (await pres.post("/events", create_body(app, { date: future_date(app, 16) }))).body.data;
    const path = `/bookings/${event.booking.id}/decision`;
    assert.equal((await pres.post(path, { expected_version: 1, decision: "approve" })).status, 403, "students cannot decide");
    assert.equal((await adminc.post(path, { expected_version: 1, decision: "approve" })).body.error.code, "SELF_DECISION_FORBIDDEN");
    assert.ok((await admin.post(path, { expected_version: 1, decision: "reject" })).body.error.fields.reason);
    assert.equal((await admin.post(path, { decision: "approve" })).status, 422);
    assert.equal((await admin.post(path, { expected_version: 9, decision: "approve" })).body.error.code, "STALE_VERSION");
    const rejected = await admin.post(path, { expected_version: 1, decision: "reject", reason: "Closed that day" });
    assert.equal(rejected.body.data.status, "rejected");
    assert.equal((await admin.post(path, { expected_version: 2, decision: "approve" })).body.error.code, "INVALID_STATE");
    const seen = await pres.get(`/events/${event.id}`);
    assert.equal(seen.body.data.booking.decision_reason, "Closed that day");
    assert.equal((await pres.post(`/events/${event.id}/publish`, { expected_version: 1 })).body.error.code, "INVALID_STATE");
  });

  test("a committee member's request waits for the president, who sends it on or returns it", async () => {
    const comm = await app.client_for("comm@x.test");
    const pres = await app.client_for("pres@x.test");
    const admin = await app.client_for("admin@x.test");
    const event = (await comm.post("/events", create_body(app, { date: future_date(app, 18) }))).body.data;
    assert.equal(event.booking.status, "awaiting_president");
    assert.equal((await admin.get("/bookings?status=pending")).body.data.some((b) => b.id === event.booking.id), false, "admins never see awaiting requests");
    assert.equal((await admin.post(`/bookings/${event.booking.id}/decision`, { expected_version: 1, decision: "approve" })).body.error.code, "INVALID_STATE");
    const signoffs = (await pres.get("/me/signoffs")).body.data;
    assert.equal(signoffs.bookings.some((b) => b.id === event.booking.id), true);
    assert.equal((await comm.post(`/bookings/${event.booking.id}/signoff`, { expected_version: 1, decision: "send" })).status, 403);
    assert.ok((await pres.post(`/bookings/${event.booking.id}/signoff`, { expected_version: 1, decision: "return" })).body.error.fields.reason);
    const sent = await pres.post(`/bookings/${event.booking.id}/signoff`, { expected_version: 1, decision: "send" });
    assert.equal(sent.body.data.status, "pending");
    assert.equal((await admin.get("/bookings?status=pending")).body.data.some((b) => b.id === event.booking.id), true);
    const other = (await comm.post("/events", create_body(app, { date: future_date(app, 19) }))).body.data;
    const returned = await pres.post(`/bookings/${other.booking.id}/signoff`, { expected_version: 1, decision: "return", reason: "Wrong room" });
    assert.equal(returned.body.data.status, "returned");
    const [[noti]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'signoff_decided'", [ids.comm]);
    assert.equal(Number(noti.n), 2);
    assert.equal((await pres.post(`/bookings/${other.booking.id}/signoff`, { expected_version: 2, decision: "send" })).body.error.code, "INVALID_STATE");
  });

  test("two presidents are impossible; committee publication needs sign-off; only the president cancels published events", async () => {
    await assert.rejects(() => app.admin.query("UPDATE memberships SET role = 'president' WHERE user_id = ? AND club_id = 1", [ids.comm]), /Duplicate/);
    const comm = await app.client_for("comm@x.test");
    const pres = await app.client_for("pres@x.test");
    const admin = await app.client_for("admin@x.test");
    const event = (await pres.post("/events", create_body(app, { date: future_date(app, 20) }))).body.data;
    await admin.post(`/bookings/${event.booking.id}/decision`, { expected_version: 1, decision: "approve" });
    const asked = await comm.post(`/events/${event.id}/publish`, { expected_version: 1 });
    assert.equal(asked.body.data.state, "awaiting_president");
    assert.equal((await comm.post(`/events/${event.id}/signoff`, { expected_version: 2, decision: "publish" })).status, 403);
    const published = await pres.post(`/events/${event.id}/signoff`, { expected_version: 2, decision: "publish" });
    assert.equal(published.body.data.state, "published");
    const members = (await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE type = 'event_published' AND event_id = ?", [event.id]))[0][0];
    assert.equal(Number(members.n), 3, "all other club members hear about it (actor excluded)");
    assert.equal((await comm.post(`/events/${event.id}/cancel`, { expected_version: 3, reason: "x" })).status, 403);
    assert.equal((await pres.post(`/events/${event.id}/cancel`, { expected_version: 3, reason: "Weather" })).body.data.state, "cancelled");
  });

  test("edit rules: published freezes fields, stale versions conflict, approval is not publication, empty patch is 422", async () => {
    const event = await published_event(app, ids, { date: future_date(app, 22), slot_id: "afternoon" });
    const pres = await app.client_for("pres@x.test");
    assert.equal((await pres.patch(`/events/${event.id}`, { expected_version: event.version })).status, 422);
    const frozen = await pres.patch(`/events/${event.id}`, { expected_version: event.version, capacity: 5 });
    assert.equal(frozen.body.error.code, "PUBLISHED_FIELDS_FROZEN", JSON.stringify(frozen.body));
    const renamed = await pres.patch(`/events/${event.id}`, { expected_version: event.version, title: "Renamed" });
    assert.equal(renamed.body.data.title, "Renamed");
    assert.equal(renamed.body.data.version, event.version + 1);
    assert.equal((await pres.patch(`/events/${event.id}`, { expected_version: event.version, title: "Again" })).body.error.code, "STALE_VERSION");
    const mem = await app.client_for("mem@x.test");
    assert.equal((await mem.patch(`/events/${event.id}`, { expected_version: 9, title: "x" })).status, 403);
  });

  test("cancel is atomic and idempotent, releases the slot and never promotes (R4)", async () => {
    const event = await published_event(app, ids, { date: future_date(app, 24), capacity: 1 });
    const [s1, s2, pres] = await Promise.all([app.client_for("s1@x.test"), app.client_for("s2@x.test"), app.client_for("pres@x.test")]);
    assert.equal((await s1.post(`/events/${event.id}/registration`, { allow_waitlist: true })).body.data.status, "joined");
    assert.equal((await s2.post(`/events/${event.id}/registration`, { allow_waitlist: true })).body.data.status, "waitlisted");
    const cancelled = await pres.post(`/events/${event.id}/cancel`, { expected_version: event.version, reason: "Weather" });
    assert.equal(cancelled.status, 200);
    const [rows] = await app.admin.query("SELECT user_id, status FROM participations WHERE event_id = ? ORDER BY user_id", [event.id]);
    assert.ok(rows.every((row) => row.status === "cancelled"));
    const [[hist]] = await app.admin.query("SELECT COUNT(*) AS n FROM participation_history WHERE event_id = ? AND action = 'cancelled'", [event.id]);
    assert.equal(Number(hist.n), 2);
    const [[b]] = await app.admin.query("SELECT status FROM bookings WHERE id = ?", [event.booking.id]);
    assert.equal(b.status, "cancelled");
    const again = await pres.post(`/events/${event.id}/cancel`, { expected_version: 1, reason: "Weather" });
    assert.equal(again.status, 200, "already cancelled returns 200 even with a stale version");
    const [[hist2]] = await app.admin.query("SELECT COUNT(*) AS n FROM participation_history WHERE event_id = ? AND action = 'cancelled'", [event.id]);
    assert.equal(Number(hist2.n), 2, "no duplicate history");
    assert.equal((await s1.get(`/events/${event.id}`)).status, 200, "historical participants still see it");
    assert.equal((await app.client_for("s3@x.test").then((c) => c.get(`/events/${event.id}`))).status, 404);
    const rebook = await pres.post("/events", create_body(app, { date: future_date(app, 24), capacity: 1 }));
    assert.equal(rebook.status, 201, "slot was released");
  });

  test("cancel after the event started is rejected", async () => {
    const event = await published_event(app, ids, { date: future_date(app, 26) });
    app.set_now(new Date(Date.parse(event.start_at) + 60_000));
    const pres = await app.client_for("pres@x.test");
    assert.equal((await pres.post(`/events/${event.id}/cancel`, { expected_version: event.version, reason: "Late" })).body.error.code, "EVENT_STARTED");
    app.set_now(new Date("2026-11-16T00:00:00Z"));
  });

  test("filters, search and tags combine; retired tags drop out of the picker", async () => {
    const pres = await app.client_for("pres@x.test");
    const admin = await app.client_for("admin@x.test");
    const music = (await pres.get("/tags")).body.data.find((tag) => tag.slug === "music");
    const date = future_date(app, 30);
    const tagged = await published_event(app, ids, { date, slot_id: "evening", title: "Jazz night", campus_tag_ids: [music.id] });
    const student = await app.client_for("s1@x.test");
    const by_tag = await student.get("/events?tag=music");
    assert.deepEqual(by_tag.body.data.map((e) => e.id), [tagged.id]);
    assert.equal((await student.get("/events?tag=music&tag=sports")).body.data.length, 1, "OR across tags");
    assert.equal((await student.get("/events?tag=music&club_id=2")).body.data.length, 0, "AND with other filters");
    assert.equal((await student.get("/events?q=Music")).body.data.some((e) => e.id === tagged.id), true, "keyword matches tag names");
    assert.equal((await student.get("/events?q=100%25")).body.data.length, 0, "wildcards are literal");
    assert.equal((await student.get("/events?tag=a&tag=b&tag=c&tag=d&tag=e&tag=f")).status, 422);
    assert.equal((await student.get("/events?club_id=1&club_id=2")).status, 422);
    assert.equal((await student.get("/events?from=2026-01-01T00:00:00Z")).status, 422);
    assert.equal((await admin.patch(`/tags/${music.id}`, { retired: true })).status, 200);
    assert.equal((await pres.get("/tags")).body.data.some((tag) => tag.slug === "music"), false);
    assert.ok((await pres.post("/events", create_body(app, { date: future_date(app, 31), campus_tag_ids: [music.id] }))).body.error.fields.campus_tag_ids, "retired tags cannot be chosen");
    const ev = (await student.get(`/events/${tagged.id}`)).body.data;
    assert.deepEqual(ev.campus_tags.map((t) => t.slug), ["music"], "existing events keep a retired tag");
    assert.equal((await student.post("/tags", { slug: "x", name: "X" })).status, 403);
  });

  test("club tags are shared only within the club and capped", async () => {
    const pres = await app.client_for("pres@x.test");
    const pres2 = await app.client_for("pres2@x.test");
    const tag = (await pres.post("/clubs/1/tags", { name: "Beginners" })).body.data;
    assert.equal((await pres.post("/clubs/1/tags", { name: "beginners" })).status, 422, "case-insensitive duplicate");
    assert.equal((await app.client_for("mem@x.test").then((c) => c.post("/clubs/1/tags", { name: "Nope" }))).status, 403);
    const wrong = await pres2.post("/events", create_body(app, { club_id: 2, venue_id: 2, capacity: 5, date: future_date(app, 33), club_tag_ids: [tag.id] }));
    assert.ok(wrong.body.error.fields.club_tag_ids);
    const ok = await pres.post("/events", create_body(app, { date: future_date(app, 33), club_tag_ids: [tag.id] }));
    assert.deepEqual(ok.body.data.club_tags, [{ id: tag.id, name: "Beginners" }]);
    const edited = await pres.patch(`/events/${ok.body.data.id}`, { expected_version: 1, club_tag_ids: [] });
    assert.deepEqual(edited.body.data.club_tags, []);
  });
});
