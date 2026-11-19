import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { create_throttle } from "../features/users/password_hasher.js";
import { KEY_PATTERN, delete_photo_files, parse_photo_fields, photo_dto, photo_path, photo_upload, store_photo } from "../features/covers/photo_service.js";
import { define_route } from "./router.js";
import { audit, id_param, require_user, to_db, wrap } from "./common.js";
import { is_committee } from "./clubs.js";

const IS_PHOTO_UPLOAD = (req) => req.method === "PUT" && /^\/clubs\/\d+\/photo$/.test(req.path);

// PUT/DELETE /clubs/:club_id/photo and GET /clubs/:club_id/photo/:size. Like
// the club icon: the committee (and president) change it, anyone signed in can
// read it. The files are written before the transaction and removed if it
// fails; a replaced or removed file is deleted after commit.
function create_club_photos_router({ pool, clock, cover_dir }) {
  const router = express.Router();
  const limiter = create_throttle({ limit: 20, window_ms: 10 * 60_000, now: () => clock().getTime() });

  async function guard(req, club_id) {
    const [[club]] = await pool.query("SELECT id FROM clubs WHERE id = ?", [club_id]);
    if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
    const [[mine]] = await pool.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
    if (!is_committee(mine)) throw new ApiError("FORBIDDEN", "Only the club committee can change the club photo.");
  }

  // Swaps the stored key under a row lock and returns the previous key.
  async function commit(req, club_id, { key, alt }) {
    const now = clock();
    return with_transaction(pool, async (conn) => {
      const [[club]] = await conn.query("SELECT photo_key FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
      if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
      await conn.query("UPDATE clubs SET photo_key = ?, photo_alt = ?, photo_updated_at = ? WHERE id = ?",
        [key ?? null, key ? alt : null, key ? to_db(now) : null, club_id]);
      await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: key ? "club.photo_set" : "club.photo_removed", now });
      return club.photo_key;
    });
  }

  async function respond(res, club_id) {
    const [[row]] = await pool.query("SELECT id, photo_key, photo_alt, photo_updated_at FROM clubs WHERE id = ?", [club_id]);
    res.json({ data: { club_id, photo: photo_dto(club_id, row) } });
  }

  define_route(router, "/clubs/:club_id/photo", {
    put: [require_user, photo_upload(), wrap(async (req, res) => {
      const id = id_param(req, "club_id");
      await guard(req, id);
      const fields = parse_photo_fields(req.body);
      limiter.hit(`club-photo:${req.user.id}`);
      const { key } = await store_photo(cover_dir, req.file?.buffer);
      try {
        const old = await commit(req, id, { key, alt: fields.alt });
        if (old) await delete_photo_files(cover_dir, old);
      } catch (error) {
        await delete_photo_files(cover_dir, key);
        throw error;
      }
      await respond(res, id);
    })],
    delete: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "club_id");
      await guard(req, id);
      const old = await commit(req, id, {});
      if (old) await delete_photo_files(cover_dir, old);
      await respond(res, id);
    })],
  });

  define_route(router, "/clubs/:club_id/photo/:size", {
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "club_id");
      const size = req.params.size;
      const [[row]] = await pool.query("SELECT photo_key FROM clubs WHERE id = ?", [id]);
      if (!row?.photo_key || !["card", "full"].includes(size) || !KEY_PATTERN.test(row.photo_key)) throw new ApiError("NOT_FOUND", "That club has no photo.");
      const etag = `"${row.photo_key}-${size}"`;
      res.set({ "Cache-Control": "private, max-age=86400", ETag: etag, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" });
      if (req.get("if-none-match") === etag) return res.status(304).end();
      const file = photo_path(cover_dir, row.photo_key, size);
      try {
        res.set("Content-Length", String((await stat(file)).size));
      } catch {
        throw new ApiError("NOT_FOUND", "That club has no photo.");
      }
      createReadStream(file).pipe(res);
    })],
  });

  return router;
}

export { IS_PHOTO_UPLOAD, create_club_photos_router };
