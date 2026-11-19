import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { render_icon } from "../features/covers/icon_service.js";
import { DEMO_CLUB_ICONS } from "./demo_club_icons.js";
import { CLUBS } from "./demo_seed.js";

const read = (file) => readFile(new URL(`../../db/demo-icons/${file}`, import.meta.url));

test("every demo club has its own icon image", () => {
  assert.deepEqual(Object.keys(DEMO_CLUB_ICONS).sort(), CLUBS.map((club) => club.key).sort());
  const files = Object.values(DEMO_CLUB_ICONS);
  assert.equal(new Set(files).size, files.length, "each club uses its own image");
});

test("the icon files are square images that the icon pipeline accepts and keep their transparency", async () => {
  const seen = new Set();
  for (const [key, file] of Object.entries(DEMO_CLUB_ICONS)) {
    const bytes = await read(file);
    const meta = await sharp(bytes).metadata();
    assert.ok(meta.width === meta.height && meta.width >= 128, `${key} is square and at least 128 px`);
    const stored = await render_icon(bytes);
    const out = await sharp(stored).metadata();
    assert.deepEqual([out.format, out.width, out.height, out.hasAlpha], ["webp", 256, 256, true], key);
    seen.add(stored.toString("base64"));
  }
  assert.equal(seen.size, CLUBS.length, "no two clubs share an icon");
});
