import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";

// Source transactions write live_signals rows: public for published-event
// seat changes, club-only for requests, drafts and check-in.

const { skip } = test_db_config();
let app;
let ids;

const signals = async (event_id) => (await app.admin.query(
  "SELECT topic, public FROM live_signals WHERE event_id = ? ORDER BY id", [event_id]))[0].map((row) => `${row.topic}:${row.public ? "public" : "club"}`);

describe("v1 live signals", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("draft, publication, registration, request and check-in each leave the right hint", async () => {
    const event = await published_event(app, ids, { date: future_date(app, 4), visibility: "members_only" });
    // Approval of the draft is club-only; publication is public.
    assert.deepEqual(await signals(event.id), ["event:club", "event:public"]);
    const comm = await app.client_for("comm@x.test");
    await comm.post(`/events/${event.id}/registration`, { allow_waitlist: true });
    const mem = await app.client_for("mem@x.test");
    await mem.post(`/events/${event.id}/registration`, { allow_waitlist: true });
    assert.deepEqual((await signals(event.id)).slice(2), ["event:public", "event:club"], "seat taken is public; a pending request is club-only");
    await app.admin.query("DELETE FROM live_signals");

    // Committee marking attendance is club-only.
    await app.admin.query("UPDATE events SET checkin_code = '1234', checkin_opened_at = UTC_TIMESTAMP(6) WHERE id = ?", [event.id]);
    await comm.put(`/events/${event.id}/attendance/${ids.comm}`, {});
    assert.deepEqual(await signals(event.id), ["attendance:club"]);
  });

  test("rolled-back writes leave no hint", async () => {
    const event = await published_event(app, ids, { date: future_date(app, 6), capacity: 1 });
    const s1 = await app.client_for("s1@x.test");
    const s2 = await app.client_for("s2@x.test");
    await s1.post(`/events/${event.id}/registration`, { allow_waitlist: false });
    const [[{ n: before_full }]] = await app.admin.query("SELECT COUNT(*) AS n FROM live_signals WHERE event_id = ?", [event.id]);
    assert.equal((await s2.post(`/events/${event.id}/registration`, { allow_waitlist: false })).body.error.code, "EVENT_FULL");
    const [[{ n }]] = await app.admin.query("SELECT COUNT(*) AS n FROM live_signals WHERE event_id = ?", [event.id]);
    assert.equal(Number(n), Number(before_full));
  });
});
