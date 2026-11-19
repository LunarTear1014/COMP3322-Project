import assert from "node:assert/strict";
import { readdir, readFile, utimes } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { test_db_config } from "../../test/db_helper.js";
import { Client, ORIGIN, start_v1 } from "../../test/v1_harness.js";
import { build_world } from "../../test/world.js";
import { sweep_orphan_icons } from "../features/covers/icon_service.js";

const { skip } = test_db_config();
let app;
let icon_dir;
const colour = { r: 40, g: 140, b: 200 };
const png = (w = 300, h = 300) => sharp({ create: { width: w, height: h, channels: 4, background: { ...colour, alpha: 0.5 } } }).png().toBuffer();
const jpeg = (w = 400, h = 400, exif) => {
  let image = sharp({ create: { width: w, height: h, channels: 3, background: colour } });
  if (exif) image = image.withExif(exif);
  return image.jpeg().toBuffer();
};
const gps = { IFD0: { Copyright: "someone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "22/1 17/1 0/1" } };

function upload(client, club_id, file, { name = "i.png", type = "image/png" } = {}) {
  const form = new FormData();
  if (file) form.set("file", new Blob([file], { type }), name);
  return client.request("PUT", `/clubs/${club_id}/icon`, form, { raw: true });
}
const icons = async () => (await readdir(icon_dir).catch(() => [])).filter((name) => name.endsWith(".icon.webp")).sort();

describe("v1 club icons", { skip }, () => {
  before(async () => { app = await start_v1(); await build_world(app); icon_dir = app.stack.deps.cover_dir; });
  after(async () => { await app?.stop(); });

  test("create: committee uploads a PNG, it is stored as a sanitized 256 px WebP and listed on the club", async () => {
    const comm = await app.client_for("comm@x.test");
    const result = await upload(comm, 1, await png());
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const { icon } = result.body.data;
    assert.deepEqual([icon.width, icon.height], [256, 256]);
    assert.match(icon.url, /^\/api\/v1\/clubs\/1\/icon\?v=[0-9a-f]{32}$/);
    const names = await icons();
    assert.equal(names.length, 1);
    const meta = await sharp(await readFile(path.join(icon_dir, names[0]))).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ["webp", 256, 256, true]);
    const student = await app.client_for("s1@x.test");
    const listed = (await student.get("/clubs")).body.data.find((club) => club.id === 1);
    assert.equal(listed.icon.url, icon.url);
    assert.equal((await student.get("/clubs")).body.data.find((club) => club.id === 2).icon, null);
    const mine = (await comm.get("/me/memberships")).body.data.find((m) => m.club_id === 1);
    assert.equal(mine.club_icon.url, icon.url);
    const [[audit]] = await app.admin.query("SELECT action FROM audit_logs WHERE entity_type = 'membership' AND entity_id = 1 AND action LIKE 'club.icon_%' ORDER BY id DESC LIMIT 1");
    assert.equal(audit.action, "club.icon_set");
  });

  test("read: members see the file with cache headers and ETag; unknown clubs and clubs without an icon are 404", async () => {
    const student = await app.client_for("s1@x.test");
    const served = await fetch(`${app.base}/api/v1/clubs/1/icon`, { headers: { Cookie: student.cookie } });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/webp");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    const again = await fetch(`${app.base}/api/v1/clubs/1/icon`, { headers: { Cookie: student.cookie, "If-None-Match": served.headers.get("etag") } });
    assert.equal(again.status, 304);
    assert.equal((await student.get("/clubs/2/icon")).status, 404);
    assert.equal((await student.get("/clubs/999/icon")).status, 404);
    const anonymous = await fetch(`${app.base}/api/v1/clubs/1/icon`);
    assert.equal(anonymous.status, 401);
  });

  test("update: replacing swaps the key, removes the old file and strips EXIF/GPS from JPEGs", async () => {
    const pres = await app.client_for("pres@x.test");
    const first = (await pres.get("/clubs")).body.data.find((club) => club.id === 1).icon.url;
    const before_files = await icons();
    const result = await upload(pres, 1, await jpeg(500, 300, gps), { name: "a.jpg", type: "image/jpeg" });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.notEqual(result.body.data.icon.url, first);
    const after_files = await icons();
    assert.equal(after_files.length, 1, "old file deleted after commit");
    assert.notDeepEqual(after_files, before_files);
    const bytes = await readFile(path.join(icon_dir, after_files[0]));
    assert.ok(!/Exif|GPS|someone/.test(bytes.toString("latin1")));
    const meta = await sharp(bytes).metadata();
    assert.deepEqual([meta.width, meta.height], [256, 256], "non-square input is cropped to a square");
  });

  test("delete: removes the file and clears the club; deleting again is harmless", async () => {
    const comm = await app.client_for("comm@x.test");
    const removed = await comm.delete("/clubs/1/icon", {});
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.icon, null);
    assert.deepEqual(await icons(), []);
    const [[row]] = await app.admin.query("SELECT icon_key, icon_updated_at FROM clubs WHERE id = 1");
    assert.deepEqual([row.icon_key, row.icon_updated_at], [null, null]);
    assert.equal((await comm.get("/clubs/1/icon")).status, 404);
    assert.equal((await comm.delete("/clubs/1/icon", {})).status, 200);
  });

  test("validation and permissions: 413, 415, 422, 403, 404 and nothing is stored by failed uploads", async () => {
    const comm = await app.client_for("comm@x.test");
    assert.equal((await upload(comm, 1, Buffer.alloc(2 * 1024 * 1024 + 100, 1))).status, 413);
    assert.equal((await upload(comm, 1, Buffer.from("not an image"))).status, 415);
    const gif = await sharp({ create: { width: 300, height: 300, channels: 3, background: colour } }).gif().toBuffer();
    assert.equal((await upload(comm, 1, gif, { name: "i.png" })).status, 415, "GIF renamed to .png");
    const small = await upload(comm, 1, await png(100, 100));
    assert.equal(small.status, 422);
    assert.ok(small.body.error.fields.file);
    assert.equal((await upload(comm, 1, null)).status, 422);
    const member = await app.client_for("mem@x.test");
    assert.equal((await upload(member, 1, await png())).status, 403);
    assert.equal((await member.delete("/clubs/1/icon", {})).status, 403);
    const other_president = await app.client_for("pres2@x.test");
    assert.equal((await upload(other_president, 1, await png())).status, 403, "another club's president has no say");
    assert.equal((await upload(comm, 999, await png())).status, 404);
    assert.deepEqual(await icons(), []);
    const unauth = new Client(app.base);
    unauth.csrf = "x";
    assert.ok([401, 403].includes((await upload(unauth, 1, await png())).status));
  });

  test("CSRF and Origin still apply to the multipart route", async () => {
    const pres = await app.client_for("pres@x.test");
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.png");
    const bad = await fetch(`${app.base}/api/v1/clubs/1/icon`, { method: "PUT", headers: { Origin: ORIGIN, Cookie: pres.cookie }, body: form });
    assert.equal((await bad.json()).error.code, "CSRF_INVALID");
  });

  test("sweep removes unreferenced icons older than the grace period and keeps referenced or fresh ones", async () => {
    const pres = await app.client_for("pres@x.test");
    await upload(pres, 1, await png());
    const [[kept]] = await app.admin.query("SELECT icon_key FROM clubs WHERE id = 1");
    const { writeFile } = await import("node:fs/promises");
    const orphan = path.join(icon_dir, `${"a".repeat(32)}.icon.webp`);
    const fresh = path.join(icon_dir, `${"b".repeat(32)}.icon.webp`);
    await writeFile(orphan, "x");
    await writeFile(fresh, "x");
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(orphan, old, old);
    assert.equal(await sweep_orphan_icons(icon_dir, [kept.icon_key]), 1);
    const names = await icons();
    assert.ok(names.includes(`${kept.icon_key}.icon.webp`));
    assert.ok(names.includes(`${"b".repeat(32)}.icon.webp`));
    assert.ok(!names.includes(`${"a".repeat(32)}.icon.webp`));
  });
});
