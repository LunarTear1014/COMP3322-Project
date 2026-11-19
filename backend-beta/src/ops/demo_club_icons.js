import { readFile } from "node:fs/promises";
import { with_transaction } from "../db/transaction.js";
import { delete_icon_file, store_icon } from "../features/covers/icon_service.js";
import { audit, to_db } from "../api_v1/common.js";
import { CLUBS } from "./demo_seed.js";

// Icons for the demo clubs (db/demo-icons/<club key>.webp). They are the
// generated club icons from generated-club-icons/ at the repository root,
// resized to 512 px so they fit in the backend image. attach_demo_club_icons
// gives each demo club its icon when the club has no icon yet, so it never
// replaces an icon someone uploaded and a second run changes nothing. Clubs are
// matched by name; icons go through the same pipeline as uploads (square WebP
// on COVER_DIR) and are audited as the club president when there is one.

const ICON_DIR = new URL("../../db/demo-icons/", import.meta.url);

const DEMO_CLUB_ICONS = {
  photo: "photo.webp",
  film: "film.webp",
  debate: "debate.webp",
  hiking: "hiking.webp",
  robotics: "robotics.webp",
};

async function attach_demo_club_icons({ pool, cover_dir, now = new Date(), log = console.log }) {
  const result = { attached: 0, already: 0, missing: 0 };
  for (const club of CLUBS) {
    const file = DEMO_CLUB_ICONS[club.key];
    if (!file) continue;
    const [[row]] = await pool.query("SELECT id, icon_key FROM clubs WHERE name = ?", [club.name]);
    if (!row) { result.missing += 1; continue; }
    if (row.icon_key) { result.already += 1; continue; }
    const { key } = await store_icon(cover_dir, await readFile(new URL(file, ICON_DIR)));
    const updated = await with_transaction(pool, async (conn) => {
      const [update] = await conn.query(
        "UPDATE clubs SET icon_key = ?, icon_updated_at = ? WHERE id = ? AND icon_key IS NULL", [key, to_db(now), row.id]);
      if (!update.affectedRows) return false;
      const [[president]] = await conn.query("SELECT user_id FROM memberships WHERE club_id = ? AND role = 'president'", [row.id]);
      await audit(conn, { actor: president?.user_id, entity_type: "membership", entity_id: row.id, action: "club.icon_set", details: { source: "demo_club_icons" }, now });
      return true;
    }).catch(async (error) => {
      await delete_icon_file(cover_dir, key);
      throw error;
    });
    if (updated) result.attached += 1;
    else { await delete_icon_file(cover_dir, key); result.already += 1; }
  }
  log?.(`Demo club icons: ${result.attached} attached, ${result.already} already had an icon, ${result.missing} demo clubs not found.`);
  return result;
}

export { DEMO_CLUB_ICONS, attach_demo_club_icons };
