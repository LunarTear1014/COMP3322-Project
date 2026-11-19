import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { test_db_config } from "../../test/db_helper.js";
import { Client, ORIGIN, start_v1 } from "../../test/v1_harness.js";
import { build_world } from "../../test/world.js";

const { skip } = test_db_config();
let app;
let dir;
const colour = { r: 40, g: 140, b: 200 };
const png = (w = 900, h = 600) => sharp({ create: { width: w, height: h, channels: 4, background: { ...colour, alpha: 1 } } }).png().toBuffer();
const jpeg = (w = 1000, h = 700, exif) => {
  let image = sharp({ create: { width: w, height: h, channels: 3, background: colour } });
  if (exif) image = image.withExif(exif);
  return image.jpeg().toBuffer();
};
const gps = { IFD0: { Copyright: "someone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "22/1 17/1 0/1" } };

function upload(client, club_id, file, { name = "p.png", type = "image/png", alt = "Club members at a table" } = {}) {
  const form = new FormData();
  if (file) form.set("file", new Blob([file], { type }), name);
  if (alt !== null) form.set("alt", alt);
  return client.request("PUT", `/clubs/${club_id}/photo`, form, { raw: true });
}
const photos = async () => (await readdir(dir).catch(() => [])).filter((name) => name.includes(".photo.")).sort();

describe("v1 club photos", { skip }, () => {
  before(async () => { app = await start_v1(); await build_world(app); dir = app.stack.deps.cover_dir; });
  after(async () => { await app?.stop(); });

  test("create: committee uploads a PNG, two sanitized WebP renditions are stored and the club lists the photo", async () => {
    const comm = await app.client_for("comm@x.test");
    const result = await upload(comm, 1, await png());
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const { photo } = result.body.data;
    assert.match(photo.card_url, /^\/api\/v1\/clubs\/1\/photo\/card\?v=[0-9a-f]{32}$/);
    assert.match(photo.full_url, /^\/api\/v1\/clubs\/1\/photo\/full\?v=[0-9a-f]{32}$/);
    assert.equal(photo.alt, "Club members at a table");
    const names = await photos();
    assert.equal(names.length, 2);
    const sizes = {};
    for (const name of names) {
      const meta = await sharp(await readFile(path.join(dir, name))).metadata();
      sizes[name.split(".")[2]] = [meta.format, meta.width, meta.height];
    }
    assert.deepEqual(sizes, { card: ["webp", 600, 400], full: ["webp", 1200, 800] });
    const student = await app.client_for("s1@x.test");
    const clubs = (await student.get("/clubs")).body.data;
    assert.equal(clubs.find((club) => club.id === 1).photo.card_url, photo.card_url);
    assert.equal(clubs.find((club) => club.id === 2).photo, null);
    const mine = (await comm.get("/me/memberships")).body.data.find((m) => m.club_id === 1);
    assert.equal(mine.club_photo.alt, "Club members at a table");
    const [[audit]] = await app.admin.query("SELECT action FROM audit_logs WHERE entity_type = 'membership' AND entity_id = 1 AND action LIKE 'club.photo_%' ORDER BY id DESC LIMIT 1");
    assert.equal(audit.action, "club.photo_set");
  });

  test("read: any signed-in user gets both sizes with cache headers and ETag; missing photo, size or club is 404", async () => {
    const student = await app.client_for("s1@x.test");
    for (const size of ["card", "full"]) {
      const served = await fetch(`${app.base}/api/v1/clubs/1/photo/${size}`, { headers: { Cookie: student.cookie } });
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/webp");
      assert.equal(served.headers.get("x-content-type-options"), "nosniff");
      const again = await fetch(`${app.base}/api/v1/clubs/1/photo/${size}`, { headers: { Cookie: student.cookie, "If-None-Match": served.headers.get("etag") } });
      assert.equal(again.status, 304);
    }
    assert.equal((await student.get("/clubs/1/photo/huge")).status, 404);
    assert.equal((await student.get("/clubs/2/photo/card")).status, 404);
    assert.equal((await student.get("/clubs/999/photo/card")).status, 404);
    assert.equal((await fetch(`${app.base}/api/v1/clubs/1/photo/card`)).status, 401);
  });

  test("replace: the president swaps the photo, the old files go and EXIF/GPS is stripped", async () => {
    const pres = await app.client_for("pres@x.test");
    const first = (await pres.get("/clubs")).body.data.find((club) => club.id === 1).photo.card_url;
    const result = await upload(pres, 1, await jpeg(1000, 700, gps), { name: "a.jpg", type: "image/jpeg", alt: "A new photo" });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.notEqual(result.body.data.photo.card_url, first);
    assert.equal(result.body.data.photo.alt, "A new photo");
    const names = await photos();
    assert.equal(names.length, 2, "old files deleted after commit");
    for (const name of names) assert.ok(!/Exif|GPS|someone/.test((await readFile(path.join(dir, name))).toString("latin1")));
  });

  test("delete: removes the files and clears the club; deleting again is harmless", async () => {
    const comm = await app.client_for("comm@x.test");
    const removed = await comm.delete("/clubs/1/photo", {});
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.photo, null);
    assert.deepEqual(await photos(), []);
    const [[row]] = await app.admin.query("SELECT photo_key, photo_alt, photo_updated_at FROM clubs WHERE id = 1");
    assert.deepEqual([row.photo_key, row.photo_alt, row.photo_updated_at], [null, null, null]);
    assert.equal((await comm.get("/clubs/1/photo/card")).status, 404);
    assert.equal((await comm.delete("/clubs/1/photo", {})).status, 200);
  });

  test("validation and permissions: 413, 415, 422, 403, 404 and failed uploads store nothing", async () => {
    const comm = await app.client_for("comm@x.test");
    assert.equal((await upload(comm, 1, Buffer.alloc(5 * 1024 * 1024 + 100, 1))).status, 413);
    assert.equal((await upload(comm, 1, Buffer.from("not an image"))).status, 415);
    const gif = await sharp({ create: { width: 900, height: 600, channels: 3, background: colour } }).gif().toBuffer();
    assert.equal((await upload(comm, 1, gif, { name: "p.png" })).status, 415, "GIF renamed to .png");
    const small = await upload(comm, 1, await png(300, 200));
    assert.equal(small.status, 422);
    assert.ok(small.body.error.fields.file);
    assert.equal((await upload(comm, 1, null)).status, 422, "no file");
    const no_alt = await upload(comm, 1, await png(), { alt: "  " });
    assert.equal(no_alt.status, 422);
    assert.ok(no_alt.body.error.fields.alt);
    assert.equal((await upload(comm, 1, await png(), { alt: "x".repeat(201) })).status, 422);
    const member = await app.client_for("mem@x.test");
    assert.equal((await upload(member, 1, await png())).status, 403);
    assert.equal((await member.delete("/clubs/1/photo", {})).status, 403);
    const student = await app.client_for("s1@x.test");
    assert.equal((await upload(student, 1, await png())).status, 403, "non-members cannot upload");
    const other_president = await app.client_for("pres2@x.test");
    assert.equal((await upload(other_president, 1, await png())).status, 403, "another club's president has no say");
    assert.equal((await upload(comm, 999, await png())).status, 404);
    assert.deepEqual(await photos(), []);
    const unauth = new Client(app.base);
    unauth.csrf = "x";
    assert.ok([401, 403].includes((await upload(unauth, 1, await png())).status));
  });

  test("venue admins hold no club role, so they cannot change a club photo", async () => {
    const admin = await app.client_for("admin@x.test");
    assert.equal((await upload(admin, 1, await png())).status, 403);
    assert.equal((await admin.delete("/clubs/1/photo", {})).status, 403);
  });

  test("CSRF and Origin still apply to the multipart route", async () => {
    const pres = await app.client_for("pres@x.test");
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.png");
    const bad = await fetch(`${app.base}/api/v1/clubs/1/photo`, { method: "PUT", headers: { Origin: ORIGIN, Cookie: pres.cookie }, body: form });
    assert.equal((await bad.json()).error.code, "CSRF_INVALID");
  });
});
