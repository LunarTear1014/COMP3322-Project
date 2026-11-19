import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { create_throttle } from "../features/users/password_hasher.js";
import { KEY_PATTERN, delete_icon_file, icon_dto, icon_path, icon_upload, store_icon } from "../features/covers/icon_service.js";
import { define_route } from "./router.js";
import { audit, id_param, require_user, to_db, wrap } from "./common.js";
import { is_committee } from "./clubs.js";

const IS_ICON_UPLOAD = (req) => req.method === "PUT" && /^\/clubs\/\d+\/icon$/.test(req.path);

// PUT/DELETE/GET /clubs/:club_id/icon. PUT creates or replaces the icon,
// DELETE removes it. The file is written before the transaction and removed if
// it fails; a replaced or removed file is deleted after commit.
function create_club_icons_router({ pool, clock, cover_dir }) {
  const router = express.Router();
  const limiter = create_throttle({ limit: 20, window_ms: 10 * 60_000, now: () => clock().getTime() });

  async function guard(req, club_id) {
    const [[club]] = await pool.query("SELECT id FROM clubs WHERE id = ?", [club_id]);
    if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
    const [[mine]] = await pool.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
    if (!is_committee(mine)) throw new ApiError("FORBIDDEN", "Only the club committee can change the club icon.");
  }

  // Swaps the stored key under a row lock and returns the previous key.
  async function commit(req, club_id, key) {
    const now = clock();
    return with_transaction(pool, async (conn) => {
      const [[club]] = await conn.query("SELECT icon_key FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
      if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
      await conn.query("UPDATE clubs SET icon_key = ?, icon_updated_at = ? WHERE id = ?", [key ?? null, key ? to_db(now) : null, club_id]);
      await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: key ? "club.icon_set" : "club.icon_removed", now });
      return club.icon_key;
    });
  }

  async function respond(res, club_id) {
    const [[row]] = await pool.query("SELECT id, icon_key, icon_updated_at FROM clubs WHERE id = ?", [club_id]);
    res.json({ data: { club_id, icon: icon_dto(club_id, row) } });
  }

  define_route(router, "/clubs/:club_id/icon", {
    put: [require_user, icon_upload(), wrap(async (req, res) => {
      const id = id_param(req, "club_id");
      await guard(req, id);
      limiter.hit(`icon:${req.user.id}`);
      const { key } = await store_icon(cover_dir, req.file?.buffer);
      try {
        const old = await commit(req, id, key);
        if (old) await delete_icon_file(cover_dir, old);
      } catch (error) {
        await delete_icon_file(cover_dir, key);
        throw error;
      }
      await respond(res, id);
    })],
    delete: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "club_id");
      await guard(req, id);
      const old = await commit(req, id, null);
      if (old) await delete_icon_file(cover_dir, old);
      await respond(res, id);
    })],
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "club_id");
      const [[row]] = await pool.query("SELECT icon_key FROM clubs WHERE id = ?", [id]);
      if (!row?.icon_key || !KEY_PATTERN.test(row.icon_key)) throw new ApiError("NOT_FOUND", "That club has no icon.");
      const etag = `"${row.icon_key}"`;
      res.set({ "Cache-Control": "private, max-age=86400", ETag: etag, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" });
      if (req.get("if-none-match") === etag) return res.status(304).end();
      const file = icon_path(cover_dir, row.icon_key);
      try {
        res.set("Content-Length", String((await stat(file)).size));
      } catch {
        throw new ApiError("NOT_FOUND", "That club has no icon.");
      }
      createReadStream(file).pipe(res);
    })],
  });

  return router;
}

export { IS_ICON_UPLOAD, create_club_icons_router };
