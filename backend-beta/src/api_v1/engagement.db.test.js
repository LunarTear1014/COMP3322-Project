import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";

const { skip } = test_db_config();
let app;
let ids;
let day = 3;
const fresh = (over = {}) => published_event(app, ids, { date: future_date(app, (day += 1)), ...over });
const join = (client, event) => client.post(`/events/${event.id}/registration`, { allow_waitlist: true });
const reset_clock = () => app.set_now(new Date("2026-11-16T00:00:00Z"));

describe("v1 notifications, calendar, check-in, views, reports", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("inbox lists own rows only with the global unread count; read is idempotent and owner-only", async () => {
    const event = await fresh();
    const s1 = await app.client_for("s1@x.test");
    const s2 = await app.client_for("s2@x.test");
    await join(s1, event);
    const list = await s1.get("/notifications");
    assert.equal(list.body.meta.unread_count >= 1, true);
    const first = list.body.data[0];
    assert.deepEqual(Object.keys(first).sort(), ["body", "booking_id", "club_id", "created_at", "event_id", "id", "join_request_id", "read_at", "title", "type"]);
    assert.equal((await s2.patch(`/notifications/${first.id}/read`, {})).status, 404, "another user's item is 404");
    const read = await s1.patch(`/notifications/${first.id}/read`, {});
    app.set_now(new Date(app.get_now().getTime() + 5000));
    const again = await s1.patch(`/notifications/${first.id}/read`, {});
    assert.equal(again.body.data.read_at, read.body.data.read_at, "first read_at preserved");
    // Mark as unread (MSG-01): owner-only, idempotent, and counted again.
    assert.equal((await s2.delete(`/notifications/${first.id}/read`, {})).status, 404, "another user's item is 404");
    const unread = await s1.delete(`/notifications/${first.id}/read`, {});
    assert.equal(unread.status, 200);
    assert.equal(unread.body.data.read_at, null);
    assert.equal((await s1.delete(`/notifications/${first.id}/read`, {})).body.data.read_at, null, "unread twice is fine");
    assert.equal((await s1.get("/notifications")).body.meta.unread_count, list.body.meta.unread_count, "counted as unread again");
    await s1.patch(`/notifications/${first.id}/read`, {});
    const unread_only = await s1.get("/notifications?unread_only=true&page_size=1");
    assert.equal(unread_only.body.meta.unread_count, list.body.meta.unread_count - 1, "count ignores pagination and filters");
    assert.equal((await s1.get("/notifications?unread_only=yes")).status, 422);
    assert.equal((await app.client().get("/notifications")).status, 401);
  });

  test("actions never notify their actor, and replays are deduplicated by key", async () => {
    const [[before]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications");
    await app.admin.query("INSERT IGNORE INTO notifications (user_id, type, dedup_key, title, body, event_title, message) VALUES (?, 'x', 'dup:1', 't', 'b', 't', 'b'), (?, 'x', 'dup:1', 't', 'b', 't', 'b')", [ids.s1, ids.s1]);
    const [[after_]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications");
    assert.equal(Number(after_.n) - Number(before.n), 1);
    const pres = await app.client_for("pres@x.test");
    const event = await fresh();
    void pres;
    const [[actor]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'event_published' AND event_id = ?", [ids.pres, event.id]);
    assert.equal(Number(actor.n), 0, "the publisher is excluded");
  });

  test("the SSE stream delivers a new notification to its recipient within 2 seconds", async () => {
    const s3 = await app.client_for("s3@x.test");
    const received = new Promise((resolve, reject) => {
      const request = http.get(`${app.base}/api/v1/notifications/stream`, { headers: { Cookie: s3.cookie } }, (response) => {
        assert.equal(response.statusCode, 200);
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { text += chunk; if (text.includes("event: notification")) { request.destroy(); resolve(text); } });
      });
      request.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
      setTimeout(() => reject(new Error("no event within 2 s")), 2000).unref();
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const event = await fresh();
    const started = Date.now();
    await join(s3, event);
    const text = await received;
    assert.ok(Date.now() - started < 2000);
    assert.match(text, /"type":"registration_changed"/);
    assert.match(text, /"unread_count":\d+/);
    assert.equal((await app.client().request("GET", "/notifications/stream")).status, 401);
  });

  test("calendar shows confirmed intervals only, anonymous for drafts, bounded to 31 days", async () => {
    const date = future_date(app, 40);
    const event = await published_event(app, ids, { date, slot_id: "afternoon" });
    const pres = await app.client_for("pres@x.test");
    const draft = (await pres.post("/events", { club_id: 1, venue_id: 1, title: "Hidden", description: "d", date, slot_id: "evening", visibility: "public", capacity: 2, campus_tag_ids: [app.campus_tag_id] })).body.data;
    const admin = await app.client_for("admin@x.test");
    await admin.post(`/bookings/${draft.booking.id}/decision`, { expected_version: 1, decision: "approve" });
    const student = await app.client_for("s1@x.test");
    const from = new Date(`${date}T00:00:00+08:00`).toISOString();
    const to = new Date(`${date}T23:59:59+08:00`).toISOString();
    const result = await student.get(`/venues/1/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert.equal(result.status, 200);
    const [published, hidden] = result.body.data.bookings;
    assert.equal(published.title, event.title);
    assert.deepEqual([hidden.title, hidden.event_id, hidden.club_id, hidden.busy], [null, null, null, true]);
    const other = await pres.post("/events", { club_id: 1, venue_id: 1, title: "Pending", description: "d", date, slot_id: "morning", visibility: "public", capacity: 2, campus_tag_ids: [app.campus_tag_id] });
    assert.equal(other.status, 201);
    assert.equal((await student.get(`/venues/1/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).body.data.bookings.length, 2, "pending never blocks");
    assert.equal((await student.get(`/venues/1/calendar?from=${encodeURIComponent(from)}&to=2030-01-01T00:00:00Z`)).status, 422);
    assert.equal((await student.get(`/venues/99/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status, 404);
    // A legacy cross-midnight booking blocks every slot it overlaps.
    await app.admin.query("INSERT INTO bookings (venue_id, club_id, start_time, end_time, status) VALUES (2, 2, ?, ?, 'confirmed')", [`${date} 22:00:00.000000`, `${date} 23:30:00.000000`]);
    await app.admin.query("UPDATE bookings SET end_time = DATE_ADD(start_time, INTERVAL 6 HOUR) WHERE venue_id = 2 AND club_id = 2");
    const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString();
    const cross = await student.get(`/venues/2/calendar?from=${encodeURIComponent(next)}&to=${encodeURIComponent(new Date(Date.parse(next) + 86_400_000).toISOString())}`);
    assert.equal(cross.body.data.bookings.length, 1, "the part after midnight is still visible");
  });

  test("venue schedule lists confirmed bookings across venues for admins only", async () => {
    const date = future_date(app, 45);
    const event = await published_event(app, ids, { date, slot_id: "night", capacity: 3 });
    const s1 = await app.client_for("s1@x.test");
    await join(s1, event);
    const pres = await app.client_for("pres@x.test");
    const draft = (await pres.post("/events", { club_id: 1, venue_id: 2, title: "Approved draft", description: "d", date, slot_id: "morning", visibility: "public", capacity: 2, campus_tag_ids: [app.campus_tag_id] })).body.data;
    const admin = await app.client_for("admin@x.test");
    assert.equal((await admin.post(`/bookings/${draft.booking.id}/decision`, { expected_version: 1, decision: "approve" })).status, 200);
    await pres.post("/events", { club_id: 1, venue_id: 2, title: "Still pending", description: "d", date, slot_id: "afternoon", visibility: "public", capacity: 2, campus_tag_ids: [app.campus_tag_id] });
    const from = new Date(`${date}T00:00:00+08:00`).toISOString();
    const to = new Date(`${date}T23:59:59+08:00`).toISOString();
    const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const all = await admin.get(`/admin/schedule?${range}`);
    assert.equal(all.status, 200);
    const titles = all.body.data.bookings.map((b) => b.event?.title);
    assert.deepEqual(titles, ["Approved draft", event.title], "confirmed only, in time order across venues");
    const [first, second] = all.body.data.bookings;
    assert.equal(first.event.state, "draft");
    assert.equal(first.venue.id, 2);
    assert.ok(first.venue.name && first.club.name);
    assert.equal(second.event.state, "published");
    assert.equal(second.event.joined_count, 1);
    assert.equal(all.body.data.pending_requests, 1, "pending requests are counted, not listed");

    const one = await admin.get(`/admin/schedule?${range}&venue_id=1`);
    assert.deepEqual(one.body.data.bookings.map((b) => b.event?.title), [event.title]);
    assert.equal(one.body.data.pending_requests, 0);

    assert.equal((await admin.get(`/admin/schedule?from=${encodeURIComponent(from)}&to=2030-01-01T00:00:00Z`)).status, 422, "bounded to 31 days");
    assert.equal((await admin.get("/admin/schedule")).status, 422);
    assert.equal((await pres.get(`/admin/schedule?${range}`)).status, 403);
    assert.equal((await app.client().request("GET", `/admin/schedule?${range}`)).status, 401);
  });

  test("check-in: window, joined-only, code, rate limit, idempotent marks (R: attendance)", async () => {
    const date = future_date(app, 50);
    const event = await published_event(app, ids, { date, capacity: 3 });
    const [s1, s2, s3, comm] = await Promise.all(["s1", "s2", "s3", "comm"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event);
    assert.equal((await comm.post(`/events/${event.id}/checkin`, {})).body.error.code, "INVALID_STATE", "too early");
    app.set_now(new Date(Date.parse(event.start_at) - 29 * 60_000));
    const opened = await comm.post(`/events/${event.id}/checkin`, {});
    assert.equal(opened.status, 200);
    assert.match(opened.body.data.code, /^\d{4}$/);
    assert.equal((await comm.post(`/events/${event.id}/checkin`, {})).body.data.code, opened.body.data.code, "idempotent");
    assert.equal((await s1.post(`/events/${event.id}/checkin`, {})).status, 403, "students cannot open");
    const [[n]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE type = 'checkin_opened' AND event_id = ?", [event.id]);
    assert.equal(Number(n.n), 2, "joined students are told");
    assert.equal((await s3.post(`/events/${event.id}/attendance`, { code: opened.body.data.code })).status, 403, "not joined");
    const wrong = opened.body.data.code === "0000" ? "1111" : "0000";
    assert.equal((await s1.post(`/events/${event.id}/attendance`, { code: wrong })).status, 422);
    const ok = await s1.post(`/events/${event.id}/attendance`, { code: opened.body.data.code });
    assert.equal(ok.status, 201);
    assert.equal((await s1.post(`/events/${event.id}/attendance`, { code: opened.body.data.code })).status, 200, "existing check-in is returned");
    for (let i = 0; i < 5; i += 1) await s2.post(`/events/${event.id}/attendance`, { code: wrong });
    const limited = await s2.post(`/events/${event.id}/attendance`, { code: opened.body.data.code });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, "RATE_LIMITED");
    assert.equal((await comm.put(`/events/${event.id}/attendance/${ids.s2}`, {})).body.data.method, "marked");
    assert.equal((await comm.put(`/events/${event.id}/attendance/${ids.s3}`, {})).status, 409, "only joined can be marked");
    const list = await comm.get(`/events/${event.id}/attendance`);
    assert.deepEqual([list.body.data.joined_at_open, list.body.data.attended], [2, 2]);
    assert.equal((await comm.delete(`/events/${event.id}/attendance/${ids.s2}`)).status, 204);
    assert.equal((await s1.get(`/events/${event.id}/attendance`)).status, 403);
    app.set_now(new Date(Date.parse(event.end_at) + 3 * 3_600_000));
    assert.equal((await s2.post(`/events/${event.id}/attendance`, { code: "1234" })).body.error.code, "INVALID_STATE", "closed after the window");
    reset_clock();
  });

  test("view tracking deduplicates per 30-minute bucket and validates the source", async () => {
    const event = await fresh();
    const s1 = await app.client_for("s1@x.test");
    const t0 = new Date(Math.floor(Date.parse("2026-11-16T03:00:00Z") / 1_800_000) * 1_800_000 + 60_000);
    app.set_now(t0);
    assert.equal((await s1.post(`/events/${event.id}/views`, { source: "explore" })).status, 204);
    assert.equal((await s1.post(`/events/${event.id}/views`, { source: "club" })).status, 204);
    app.set_now(new Date(t0.getTime() + 31 * 60_000));
    await s1.post(`/events/${event.id}/views`, { source: "inbox" });
    const [rows] = await app.admin.query("SELECT source FROM event_views WHERE event_id = ? ORDER BY id", [event.id]);
    assert.deepEqual(rows.map((r) => r.source), ["explore", "inbox"]);
    assert.equal((await s1.post(`/events/${event.id}/views`, { source: "bogus" })).status, 422);
    const pres = await app.client_for("pres@x.test");
    const draft = (await pres.post("/events", { club_id: 1, venue_id: 1, title: "Hid", description: "d", date: future_date(app, 70), slot_id: "morning", visibility: "public", capacity: 2, campus_tag_ids: [app.campus_tag_id] })).body.data;
    assert.equal((await s1.post(`/events/${draft.id}/views`, { source: "explore" })).status, 404);
    reset_clock();
  });

  test("club report: committee-only, zero-filled days, clipped hours, no attendance claims", async () => {
    const date = future_date(app, 80);
    const event = await published_event(app, ids, { date, capacity: 1 });
    const [s1, s2, comm, mem] = await Promise.all(["s1", "s2", "comm", "mem"].map((n) => app.client_for(`${n}@x.test`)));
    await join(s1, event); await join(s2, event);
    await s1.delete(`/events/${event.id}/registration`);
    const from = new Date(`${date}T00:00:00+08:00`);
    const pad = (n) => new Date(from.getTime() + n * 86_400_000).toISOString();
    app.set_now(new Date("2026-11-16T00:00:00Z"));
    const range = `from=${encodeURIComponent(new Date("2026-11-15T16:00:00Z").toISOString())}&to=${encodeURIComponent(pad(2))}`;
    const wide = await comm.get(`/clubs/1/reports?${range}`);
    assert.equal(wide.status, 200);
    const today = wide.body.data.daily_actions.find((d) => d.date === "2026-11-16");
    const [expected] = await app.admin.query(`SELECT h.action, COUNT(*) AS n FROM participation_history h JOIN events e ON e.id = h.event_id
      WHERE e.club_id = 1 AND e.status IN ('published', 'cancelled') AND DATE(DATE_ADD(h.occurred_at, INTERVAL 8 HOUR)) = '2026-11-16' GROUP BY h.action`);
    const want = Object.fromEntries(expected.map((r) => [r.action, Number(r.n)]));
    assert.deepEqual([today.joined, today.waitlisted, today.left, today.promoted], [want.joined ?? 0, want.waitlisted ?? 0, want.left ?? 0, want.promoted ?? 0], "repeat actions counted as actions");
    assert.ok(today.joined >= 1 && today.left >= 1 && today.promoted >= 1);
    assert.ok(wide.body.data.daily_actions.every((d) => Object.keys(d).length === 6));
    assert.ok(wide.body.data.daily_actions.length > 80, "every campus day is present, zeros included");
    assert.equal(wide.body.data.events[0].joined_count, 1);
    assert.equal(wide.body.data.events[0].waitlisted_count, 0);
    assert.ok(wide.body.data.venue_hours.length >= 1);
    assert.equal(JSON.stringify(wide.body).includes("attend"), false);
    assert.equal((await mem.get(`/clubs/1/reports?${range}`)).status, 403);
    assert.equal((await app.client_for("admin@x.test").then((c) => c.get(`/clubs/1/reports?${range}`))).status, 404, "admin alone has no report access");
    assert.equal((await comm.get("/clubs/1/reports?from=2026-01-01T00:00:00Z&to=2027-06-01T00:00:00Z")).status, 422);
    const clipped = await comm.get(`/clubs/1/reports?from=${encodeURIComponent(new Date(`${date}T10:30:00+08:00`).toISOString())}&to=${encodeURIComponent(new Date(`${date}T11:30:00+08:00`).toISOString())}`);
    assert.equal(clipped.body.data.venue_hours.find((v) => v.venue_id === 1).hours, 1, "a 3h booking clipped to a 1h window");
  });

  test("effectiveness report matches hand-built fixtures", async () => {
    const comm = await app.client_for("comm@x.test");
    await app.admin.query("DELETE FROM participation_history; DELETE FROM event_attendance; DELETE FROM event_views");
    const date = future_date(app, 120);
    const mk = async (slot_id, capacity, tag) => published_event(app, ids, { date, slot_id, capacity, ...(tag ? { campus_tag_ids: [tag] } : {}) });
    const [{ id: tag }] = (await comm.get("/tags")).body.data.filter((t) => t.slug === "sports");
    const e = await mk("morning", 2, tag);
    // Hand-built history (event start is `date` 09:00 HKT = 01:00Z). u1: join, leave, rejoin; u2: join; u3: waitlisted then promoted (no check-in); u4: waitlisted, never promoted.
    const t = (h) => new Date(Date.parse(e.start_at) - h * 3_600_000).toISOString().replace("T", " ").replace("Z", "000");
    const H = async (user, action, from, to, hours_before, actor = user) => app.admin.query(
      "INSERT INTO participation_history (event_id, user_id, actor_user_id, action_id, action, from_status, to_status, occurred_at) VALUES (?, ?, ?, UUID(), ?, ?, ?, ?)", [e.id, user, actor, action, from, to, t(hours_before)]);
    await H(ids.s1, "joined", null, "joined", 48); await H(ids.s1, "left", "joined", "left", 40); await H(ids.s1, "joined", "left", "joined", 30);
    await H(ids.s2, "joined", null, "joined", 47);
    await H(ids.s3, "waitlisted", null, "waitlisted", 46); await H(ids.s4, "waitlisted", null, "waitlisted", 45);
    await H(ids.s3, "promoted", "waitlisted", "joined", 44);
    await app.admin.query("INSERT INTO event_attendance (event_id, user_id, method, checked_in_at) VALUES (?, ?, 'code', NOW())", [e.id, ids.s1]);
    await app.admin.query("UPDATE events SET checkin_opened_at = NOW() WHERE id = ?", [e.id]);
    await app.admin.query("INSERT INTO event_views (event_id, user_id, source, viewed_at, bucket) VALUES (?, ?, 'explore', ?, ?), (?, ?, 'club', ?, ?), (?, ?, 'share', ?, ?)", [
      e.id, ids.s1, t(50), t(50), e.id, ids.s2, t(49), t(49), e.id, ids.s4, t(20), t(20)]);
    const second = await mk("afternoon", 5, tag);  // no check-in recorded
    const from = new Date(`${date}T00:00:00+08:00`);
    const range = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(new Date(from.getTime() + 86_400_000).toISOString())}`;
    const report = (await comm.get(`/clubs/1/reports/effectiveness?${range}`)).body.data;
    const row = report.events.find((x) => x.event_id === e.id);
    assert.equal(row.joined_at_start, 3, "u1, u2 and u3 hold a seat at the start");
    assert.equal(row.fill_rate, 1.5, "3 of capacity 2 (hand-built over-fill)");
    assert.equal(row.ever_joined, 3);
    assert.equal(row.dropped_out, 0, "u1 rejoined, so is not a drop-out");
    assert.equal(row.peak_waitlist, 2);
    assert.equal(row.promotions, 1);
    assert.equal(row.median_promotion_wait_hours, 2, "u3 waited from 46 h to 44 h before");
    assert.equal(row.checkin_recorded, true);
    assert.equal(row.attended, 1);
    assert.equal(row.turnout, 0.333);
    assert.equal(row.no_shows, 2);
    assert.equal(row.promoted_attended, 0, "the promoted student did not check in");
    assert.equal(row.views, 3);
    assert.equal(row.unique_viewers, 3);
    assert.deepEqual(row.views_by_source, { explore: 1, club: 1, inbox: 0, my_events: 0, share: 1, other: 0 });
    assert.equal(row.view_to_join, 0.667, "u1 and u2 joined after viewing; u4 never joined");
    const none = report.events.find((x) => x.event_id === second.id);
    assert.deepEqual([none.checkin_recorded, none.attended, none.turnout, none.no_shows, none.promoted_attended], [false, null, null, null, null]);
    assert.equal(report.by_tag.find((g) => g.slug === "sports").events, 2);
    assert.equal(report.by_tag.find((g) => g.slug === "sports").too_few, true, "fewer than 3 events");
    assert.equal(report.by_tag.find((g) => g.slug === "sports").avg_turnout, 0.333, "only events with check-in count");
    assert.deepEqual(report.by_slot.map((g) => g.slot).sort(), ["afternoon", "morning"]);
    assert.equal((await comm.get(`/clubs/1/reports/effectiveness?from=2026-01-01T00:00:00Z&to=2027-06-01T00:00:00Z`)).status, 422);
    assert.equal((await app.client_for("mem@x.test").then((c) => c.get(`/clubs/1/reports/effectiveness?${range}`))).status, 403);
  });
});
