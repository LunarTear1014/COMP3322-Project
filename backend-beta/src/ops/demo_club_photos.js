import { readFile } from "node:fs/promises";
import { with_transaction } from "../db/transaction.js";
import { delete_photo_files, store_photo } from "../features/covers/photo_service.js";
import { audit, to_db } from "../api_v1/common.js";
import { CLUBS } from "./demo_seed.js";

// Photos for the demo clubs (db/demo-images/club-*.jpg, generated for
// ClubSpace). attach_demo_club_photos gives each demo club its photo when the
// club has none yet, so it never replaces a photo someone uploaded and a second
// run changes nothing. Clubs are matched by name; photos go through the same
// pipeline as uploads (two WebP renditions on COVER_DIR) and are audited as the
// club president when there is one.

const IMAGE_DIR = new URL("../../db/demo-images/", import.meta.url);

const DEMO_CLUB_PHOTOS = {
  photo: ["club-photography.jpg", "Students smiling over a camera at a table of printed harbour photographs, with the Hong Kong skyline behind them at sunset"],
  film: ["club-film.jpg", "Students chatting in red cinema seats before a screening of a harbour skyline on the big screen"],
  debate: ["club-debate.jpg", "Students gathered around a table with laptops and notebooks as one explains a point, with the harbour visible through tall windows"],
  hiking: ["club-hiking.jpg", "A group of smiling hikers on a hillside trail with the Hong Kong skyline and harbour below"],
  robotics: ["club-robotics.jpg", "Students building and soldering small robots and a drone on a workshop table"],
};

async function attach_demo_club_photos({ pool, cover_dir, now = new Date(), log = console.log }) {
  const result = { attached: 0, already: 0, missing: 0 };
  for (const club of CLUBS) {
    const [file, alt] = DEMO_CLUB_PHOTOS[club.key] ?? [];
    if (!file) continue;
    const [[row]] = await pool.query("SELECT id, photo_key FROM clubs WHERE name = ?", [club.name]);
    if (!row) { result.missing += 1; continue; }
    if (row.photo_key) { result.already += 1; continue; }
    const { key } = await store_photo(cover_dir, await readFile(new URL(file, IMAGE_DIR)));
    const updated = await with_transaction(pool, async (conn) => {
      const [update] = await conn.query(
        "UPDATE clubs SET photo_key = ?, photo_alt = ?, photo_updated_at = ? WHERE id = ? AND photo_key IS NULL", [key, alt, to_db(now), row.id]);
      if (!update.affectedRows) return false;
      const [[president]] = await conn.query("SELECT user_id FROM memberships WHERE club_id = ? AND role = 'president'", [row.id]);
      await audit(conn, { actor: president?.user_id, entity_type: "membership", entity_id: row.id, action: "club.photo_set", details: { source: "demo_club_photos" }, now });
      return true;
    }).catch(async (error) => {
      await delete_photo_files(cover_dir, key);
      throw error;
    });
    if (updated) result.attached += 1;
    else { await delete_photo_files(cover_dir, key); result.already += 1; }
  }
  log?.(`Demo club photos: ${result.attached} attached, ${result.already} already had a photo, ${result.missing} demo clubs not found.`);
  return result;
}

export { DEMO_CLUB_PHOTOS, attach_demo_club_photos };
