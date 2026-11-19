import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";

const { skip } = test_db_config();
let app;
let ids;

describe("v1 venue administrators hold no club role and do not register", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("a venue admin cannot join a club or ask to join one", async () => {
    const admin = await app.client_for("admin@x.test");
    const joined = await admin.put("/clubs/1/membership", {});
    assert.equal(joined.status, 403);
    assert.equal(joined.body.error.code, "FORBIDDEN");
    const [[row]] = await app.admin.query("SELECT (SELECT COUNT(*) FROM memberships WHERE user_id = ?) AS m, (SELECT COUNT(*) FROM club_join_requests WHERE user_id = ?) AS r", [ids.admin, ids.admin]);
    assert.deepEqual({ m: Number(row.m), r: Number(row.r) }, { m: 0, r: 0 });
    assert.equal((await (await app.client_for("s1@x.test")).put("/clubs/1/membership", {})).status < 400, true, "students still can");
  });

  test("a venue admin cannot register for an event; students still can", async () => {
    const event = await published_event(app, ids, { date: future_date(app, 20) });
    const admin = await app.client_for("admin@x.test");
    const refused = await admin.post(`/events/${event.id}/registration`, { allow_waitlist: true });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, "FORBIDDEN");
    const [[row]] = await app.admin.query("SELECT COUNT(*) AS n FROM participations WHERE event_id = ? AND user_id = ?", [event.id, ids.admin]);
    assert.equal(Number(row.n), 0);

    const seen = await admin.get(`/events/${event.id}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.data.eligibility.reason, "VENUE_ADMIN");
    assert.equal(seen.body.data.eligibility.can_register, false);
    assert.equal(seen.body.data.eligibility.can_waitlist, false);

    const student = await (await app.client_for("s2@x.test")).get(`/events/${event.id}`);
    assert.equal(student.body.data.eligibility.can_register, true);
    assert.equal(student.body.data.eligibility.reason, null);
  });

  test("an admin with an old registration still sees it and can leave", async () => {
    const event = await published_event(app, ids, { date: future_date(app, 21) });
    await app.admin.query("INSERT INTO participations (user_id, event_id, status, last_registered_at, confirmed_at) VALUES (?, ?, 'joined', '2026-11-16 00:00:00', '2026-11-16 00:00:00')", [ids.admin, event.id]);
    const admin = await app.client_for("admin@x.test");
    assert.equal((await admin.get(`/events/${event.id}`)).body.data.eligibility.reason, "ALREADY_REGISTERED");
    assert.equal((await admin.delete(`/events/${event.id}/registration`)).status, 200);
  });
});
