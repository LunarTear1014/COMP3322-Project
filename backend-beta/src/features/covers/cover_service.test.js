import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import sharp from "sharp";
import { create_app } from "../../app.js";
import { define_route } from "../../api_v1/router.js";
import {
  cover_dto, cover_upload, delete_cover_files, parse_cover_fields, render_cover, store_cover, sweep_orphan_covers,
} from "./cover_service.js";

const background = { r: 200, g: 120, b: 60 };
async function jpeg(width, height, exif = null) {
  let image = sharp({ create: { width, height, channels: 3, background } });
  if (exif) image = image.withExif(exif);
  return image.jpeg({ quality: 70 }).toBuffer();
}
const gps = { IFD0: { Copyright: "someone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "22/1 17/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "114/1 8/1 0/1" } };

let directory;
before(async () => { directory = await mkdtemp(path.join(tmpdir(), "covers-")); });
after(async () => { await rm(directory, { recursive: true, force: true }); });

describe("render_cover", () => {
  test("produces 600x400 and 1200x800 WebP with no metadata", async () => {
    const source = await jpeg(1600, 1067, gps);
    assert.ok((await sharp(source).metadata()).exif, "fixture really carries EXIF");
    const { card, full } = await render_cover(source);
    for (const [buffer, width, height] of [[card, 600, 400], [full, 1200, 800]]) {
      const meta = await sharp(buffer).metadata();
      assert.equal(meta.format, "webp");
      assert.deepEqual([meta.width, meta.height], [width, height]);
      assert.equal(meta.exif, undefined);
      assert.equal(meta.xmp, undefined);
      assert.equal(meta.icc, undefined);
      const text = buffer.toString("latin1");
      assert.ok(!/Exif|GPS|XMP|someone/.test(text), "no metadata strings survive");
    }
  });

  test("accepts WebP input and center-crops non-3:2 images", async () => {
    const source = await sharp({ create: { width: 1600, height: 1600, channels: 3, background } }).webp().toBuffer();
    const { full } = await render_cover(source);
    assert.deepEqual([(await sharp(full).metadata()).width, (await sharp(full).metadata()).height], [1200, 800]);
  });

  test("applies EXIF orientation before checking size and cropping", async () => {
    // Stored as 1067x1600 with orientation 6 (rotate 90): displays as 1600x1067.
    const source = await sharp({ create: { width: 1067, height: 1600, channels: 3, background } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const { full } = await render_cover(source);
    assert.equal((await sharp(full).metadata()).width, 1200);
  });

  test("rejects a PNG, non-image bytes and an empty file with 415", async () => {
    const png = await sharp({ create: { width: 1600, height: 1067, channels: 3, background } }).png().toBuffer();
    for (const bad of [png, Buffer.from("<script>alert(1)</script>"), Buffer.from("GIF89a....")]) {
      await assert.rejects(() => render_cover(bad), (error) => error.code === "UNSUPPORTED_MEDIA_TYPE" && error.status === 415);
    }
    await assert.rejects(() => render_cover(Buffer.alloc(0)), (error) => error.code === "VALIDATION_FAILED");
  });

  test("rejects images under 1200x800 with a field error on file", async () => {
    await assert.rejects(async () => render_cover(await jpeg(800, 600)),
      (error) => error.code === "VALIDATION_FAILED" && error.status === 422 && /1200 by 800/.test(error.fields.file));
    await assert.rejects(async () => render_cover(await jpeg(1200, 799)), (error) => error.code === "VALIDATION_FAILED");
    assert.ok(await render_cover(await jpeg(1200, 800)));
  });
});

describe("storage lifecycle", () => {
  test("stores random-named files, replaces and removes them", async () => {
    const source = await jpeg(1600, 1067);
    const first = await store_cover(directory, source);
    assert.match(first.key, /^[0-9a-f]{32}$/);
    const files = await readdir(directory);
    assert.deepEqual(files.sort(), [`${first.key}.card.webp`, `${first.key}.full.webp`]);

    const second = await store_cover(directory, source);
    assert.notEqual(first.key, second.key, "each upload gets a fresh key");
    await delete_cover_files(directory, first.key); // after the DB commit
    assert.deepEqual((await readdir(directory)).sort(), [`${second.key}.card.webp`, `${second.key}.full.webp`]);
    await delete_cover_files(directory, second.key);
    assert.deepEqual(await readdir(directory), []);
  });

  test("delete refuses keys that are not 32 hex characters (no path traversal)", async () => {
    await delete_cover_files(directory, "../../etc/passwd");
    await delete_cover_files(directory, null);
  });

  test("the orphan sweep removes unreferenced old files and keeps referenced and recent ones", async () => {
    const source = await jpeg(1600, 1067);
    const kept = await store_cover(directory, source);
    const orphan = await store_cover(directory, source);
    const fresh = await store_cover(directory, source);
    const old = new Date(Date.now() - 2 * 3_600_000);
    for (const key of [kept.key, orphan.key]) {
      for (const size of ["card", "full"]) await utimes(path.join(directory, `${key}.${size}.webp`), old, old);
    }
    const removed = await sweep_orphan_covers(directory, [kept.key]);
    assert.equal(removed, 2);
    const left = (await readdir(directory)).sort();
    assert.deepEqual(left, [`${fresh.key}.card.webp`, `${fresh.key}.full.webp`, `${kept.key}.card.webp`, `${kept.key}.full.webp`].sort());
    await stat(path.join(directory, `${kept.key}.card.webp`));
    for (const key of [kept.key, fresh.key]) await delete_cover_files(directory, key);
  });
});

describe("cover fields and DTO", () => {
  test("alt and expected_version are validated", () => {
    assert.deepEqual(parse_cover_fields({ alt: " A hall ", expected_version: "3" }), { alt: "A hall", expected_version: 3 });
    for (const body of [{ alt: "", expected_version: "1" }, { alt: "x".repeat(201), expected_version: "1" }, { alt: "ok", expected_version: "0" }, { alt: "ok" }, {}]) {
      assert.throws(() => parse_cover_fields(body), (error) => error.code === "VALIDATION_FAILED");
    }
  });

  test("cover_dto is null without a cover and carries versioned URLs with one", () => {
    assert.equal(cover_dto(5, { cover_key: null }), null);
    const dto = cover_dto(5, { cover_key: "a".repeat(32), cover_alt: "Hall", cover_updated_at: "2026-11-12 02:00:00.000000" });
    assert.equal(dto.card_url, `/api/v1/events/5/cover/card?v=${"a".repeat(32)}`);
    assert.deepEqual([dto.width, dto.height, dto.alt, dto.updated_at], [1200, 800, "Hall", "2026-11-12T02:00:00.000Z"]);
  });
});

describe("multipart upload middleware", () => {
  let server;
  let base;
  before(async () => {
    const router = express.Router();
    define_route(router, "/upload", {
      put: [cover_upload(), async (req, res, next) => {
        try {
          const fields = parse_cover_fields(req.body);
          const stored = await render_cover(req.file?.buffer);
          res.json({ data: { ...fields, bytes: stored.full.length > 0 } });
        } catch (error) { next(error); }
      }],
    });
    const app = create_app({ session_secret: "x".repeat(32), app_origin: "http://app.test", v1_routers: [router], logger: { error() {} },
      is_multipart_route: (req) => req.path === "/upload" });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  async function put(file, name = "cover.jpg", type = "image/jpeg") {
    const csrf = await fetch(`${base}/api/v1/auth/csrf`);
    const cookie = csrf.headers.get("set-cookie").split(";")[0];
    const token = (await csrf.json()).data.csrf_token;
    const form = new FormData();
    form.set("alt", "A hall");
    form.set("expected_version", "2");
    form.set("file", new Blob([file], { type }), name);
    return fetch(`${base}/api/v1/upload`, { method: "PUT", headers: { Origin: "http://app.test", Cookie: cookie, "X-CSRF-Token": token }, body: form });
  }

  test("a valid JPEG passes through multipart", async () => {
    const response = await put(await jpeg(1600, 1067));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { alt: "A hall", expected_version: 2, bytes: true });
  });

  test("over 5 MB is 413 before decoding", async () => {
    const response = await put(Buffer.alloc(5 * 1024 * 1024 + 10, 1));
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
  });

  test("a PNG named .jpg with an image/jpeg type is 415", async () => {
    const png = await sharp({ create: { width: 1600, height: 1067, channels: 3, background } }).png().toBuffer();
    const response = await put(png, "cover.jpg", "image/jpeg");
    assert.equal(response.status, 415);
  });

  test("Origin and CSRF still apply to multipart uploads", async () => {
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.jpg");
    const response = await fetch(`${base}/api/v1/upload`, { method: "PUT", headers: { Origin: "http://app.test" }, body: form });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "CSRF_INVALID");
  });
});
