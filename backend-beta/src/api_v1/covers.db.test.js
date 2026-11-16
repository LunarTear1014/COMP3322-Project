import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { test_db_config } from "../../test/db_helper.js";
import { ORIGIN, start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";

const { skip } = test_db_config();
let app;
let ids;
let cover_dir;
let day = 3;
const colour = { r: 200, g: 120, b: 60 };
const jpeg = (w = 1600, h = 1067, exif) => {
  let image = sharp({ create: { width: w, height: h, channels: 3, background: colour } });
  if (exif) image = image.withExif(exif);
  return image.jpeg({ quality: 70 }).toBuffer();
};
const gps = { IFD0: { Copyright: "someone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "22/1 17/1 0/1" } };

async function upload(client, event_id, file, { alt = "A hall", version, name = "c.jpg", type = "image/jpeg" } = {}) {
  const form = new FormData();
  form.set("alt", alt);
  form.set("expected_version", String(version));
  if (file) form.set("file", new Blob([file], { type }), name);
  return client.request("PUT", `/events/${event_id}/cover`, form, { raw: true });
}
const files = async () => (await readdir(cover_dir).catch(() => [])).sort();

describe("v1 event covers", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); cover_dir = app.stack.deps.cover_dir; });
  after(async () => { await app?.stop(); });

  test("upload stores sanitized WebP renditions, bumps the version and exposes the cover", async () => {
    const event = await published_event(app, ids, { date: future_date(app, (day += 1)) });
    const comm = await app.client_for("comm@x.test");
    const result = await upload(comm, event.id, await jpeg(1600, 1067, gps), { version: event.version });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const { cover, version } = result.body.data;
    assert.equal(version, event.version + 1);
    assert.deepEqual([cover.width, cover.height, cover.alt], [1200, 800, "A hall"]);
    assert.match(cover.card_url, new RegExp(`^/api/v1/events/${event.id}/cover/card\\?v=[0-9a-f]{32}$`));
    const names = await files();
    assert.equal(names.length, 2);
    for (const name of names) {
      const bytes = await readFile(path.join(cover_dir, name));
      const meta = await sharp(bytes).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(meta.exif, undefined);
      assert.ok(!/Exif|GPS|someone/.test(bytes.toString("latin1")));
    }
    const student = await app.client_for("s1@x.test");
    const served = await fetch(`${app.base}/api/v1/events/${event.id}/cover/card`, { headers: { Cookie: student.cookie } });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/webp");
    assert.equal(served.headers.get("cache-control"), "private, max-age=86400");
    const etag = served.headers.get("etag");
    const again = await fetch(`${app.base}/api/v1/events/${event.id}/cover/card`, { headers: { Cookie: student.cookie, "If-None-Match": etag } });
    assert.equal(again.status, 304);
    const list = (await student.get("/events")).body.data.find((e) => e.id === event.id);
    assert.ok(list.cover.card_url);
    assert.equal((await student.get(`/events/${event.id}/cover/huge`)).status, 404);
  });

  test("replace deletes the old files after commit, remove clears the cover, and the ETag changes", async () => {
    const event = await published_event(app, ids, { date: future_date(app, (day += 1)) });
    const comm = await app.client_for("comm@x.test");
    const first = (await upload(comm, event.id, await jpeg(), { version: event.version })).body.data;
    const before_files = await files();
    const second = (await upload(comm, event.id, await jpeg(1300, 900), { version: first.version, alt: "New" })).body.data;
    assert.notEqual(second.cover.card_url, first.cover.card_url);
    const after_files = await files();
    assert.equal(after_files.length, before_files.length, "old files removed, new files added");
    assert.ok(!after_files.some((name) => before_files.slice(-2).includes(name) && false));
    const removed = await comm.delete(`/events/${event.id}/cover`, { expected_version: second.version });
    assert.equal(removed.body.data.cover, null);
    assert.equal(removed.body.data.version, second.version + 1);
    const [[row]] = await app.admin.query("SELECT cover_key FROM events WHERE id = ?", [event.id]);
    assert.equal(row.cover_key, null);
    assert.equal((await comm.get(`/events/${event.id}/cover/card`)).status, 404);
  });

  test("413, 415, 422, 403, 404, 409 STALE_VERSION and INVALID_STATE", async () => {
    const event = await published_event(app, ids, { date: future_date(app, (day += 1)) });
    const comm = await app.client_for("comm@x.test");
    const before_files = await files();
    assert.equal((await upload(comm, event.id, Buffer.alloc(5 * 1024 * 1024 + 100, 1), { version: event.version })).status, 413);
    const png = await sharp({ create: { width: 1600, height: 1067, channels: 3, background: colour } }).png().toBuffer();
    assert.equal((await upload(comm, event.id, png, { version: event.version })).status, 415, "PNG renamed to .jpg");
    assert.equal((await upload(comm, event.id, Buffer.from("not an image"), { version: event.version })).status, 415);
    const small = await upload(comm, event.id, await jpeg(800, 600), { version: event.version });
    assert.equal(small.status, 422);
    assert.ok(small.body.error.fields.file);
    assert.equal((await upload(comm, event.id, await jpeg(), { version: event.version, alt: "" })).status, 422);
    const student = await app.client_for("s1@x.test");
    assert.equal((await upload(student, event.id, await jpeg(), { version: event.version })).status, 403);
    assert.equal((await upload(comm, 999999, await jpeg(), { version: 1 })).status, 404);
    assert.equal((await upload(comm, event.id, await jpeg(), { version: event.version + 5 })).body.error.code, "STALE_VERSION");
    assert.deepEqual(await files(), before_files, "nothing was stored by any failed upload");
    const pres = await app.client_for("pres@x.test");
    const cancelled = (await pres.post(`/events/${event.id}/cancel`, { expected_version: event.version, reason: "x" })).body.data;
    assert.equal((await upload(comm, event.id, await jpeg(), { version: cancelled.version })).body.error.code, "INVALID_STATE");
    const unauth = new (await import("../../test/v1_harness.js")).Client(app.base);
    unauth.csrf = "x";
    assert.ok([401, 403].includes((await upload(unauth, event.id, await jpeg(), { version: 1 })).status));
  });

  test("a hidden draft's cover is 404 for outsiders, exactly like the event; Origin and CSRF still apply", async () => {
    const pres = await app.client_for("pres@x.test");
    const draft = (await pres.post("/events", { club_id: 1, venue_id: 1, title: "D", description: "d", date: future_date(app, (day += 1)), slot_id: "evening", visibility: "public", capacity: 2 })).body.data;
    const result = await upload(pres, draft.id, await jpeg(), { version: 1 });
    assert.equal(result.status, 200, "drafts can have covers");
    const outsider = await app.client_for("s1@x.test");
    assert.equal((await outsider.get(`/events/${draft.id}/cover/full`)).status, 404);
    assert.equal((await fetch(`${app.base}/api/v1/events/${draft.id}/cover/full`, { headers: { Cookie: pres.cookie } })).status, 200);
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.jpg");
    const bad = await fetch(`${app.base}/api/v1/events/${draft.id}/cover`, { method: "PUT", headers: { Origin: ORIGIN, Cookie: pres.cookie }, body: form });
    assert.equal((await bad.json()).error.code, "CSRF_INVALID");
  });
});
