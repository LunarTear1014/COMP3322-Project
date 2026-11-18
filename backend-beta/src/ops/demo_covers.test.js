import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { DEMO_COVERS } from "./demo_covers.js";
import { EVENTS } from "./demo_seed.js";

test("every demo event has a cover image and alt text", async () => {
  const titles = EVENTS.map((event) => event.title);
  assert.deepEqual(Object.keys(DEMO_COVERS).sort(), [...titles].sort());
  for (const [file, alt] of Object.values(DEMO_COVERS)) {
    await access(new URL(`../../db/demo-images/${file}`, import.meta.url));
    assert.ok(alt.length >= 1 && [...alt].length <= 200, `alt text for ${file}`);
  }
});

test("each demo event uses its own image", () => {
  const files = Object.values(DEMO_COVERS).map(([file]) => file);
  assert.equal(new Set(files).size, files.length);
});
