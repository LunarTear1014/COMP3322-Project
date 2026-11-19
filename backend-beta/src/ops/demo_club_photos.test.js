import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { render_photo } from "../features/covers/photo_service.js";
import { DEMO_CLUB_PHOTOS } from "./demo_club_photos.js";
import { CLUBS } from "./demo_seed.js";

test("every demo club has its own photo with alt text that the photo pipeline accepts", async () => {
  assert.deepEqual(Object.keys(DEMO_CLUB_PHOTOS).sort(), CLUBS.map((club) => club.key).sort());
  const files = Object.values(DEMO_CLUB_PHOTOS).map(([file]) => file);
  assert.equal(new Set(files).size, files.length, "each club uses its own image");
  for (const [key, [file, alt]] of Object.entries(DEMO_CLUB_PHOTOS)) {
    assert.match(file, /^club-.*\.jpg$/);
    assert.ok(alt.length >= 20 && alt.length <= 200, `${key} has useful alt text`);
    const out = await render_photo(await readFile(new URL(`../../db/demo-images/${file}`, import.meta.url)));
    assert.deepEqual(Object.keys(out), ["card", "full"]);
  }
});
