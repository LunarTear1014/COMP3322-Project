import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { validate_body } from "../shared/validate.js";
import { create_throttle } from "../features/users/password_hasher.js";
import { KEY_PATTERN, cover_upload, delete_cover_files, file_path, parse_cover_fields, render_cover, store_cover } from "../features/covers/cover_service.js";
import { define_route } from "./router.js";
import { audit, id_param, require_user, to_db, wrap } from "./common.js";
import { is_committee } from "./clubs.js";
import { load_event } from "./event_model.js";

const IS_COVER_UPLOAD = (req) => req.method === "PUT" && /^\/events\/\d+\/cover$/.test(req.path);

// PUT/DELETE/GET /events/:id/cover. Files are written before the transaction
// and removed if it fails; replaced or removed files are deleted after commit.
function create_covers_router({ pool, clock, cover_dir }) {
  const router = express.Router();
  const limiter = create_throttle({ limit: 20, window_ms: 10 * 60_000, now: () => clock().getTime() });

  async function guard(req, id, expected_version) {
    const found = await load_event(pool, req.user, id, clock());
    if (!found) throw new ApiError("NOT_FOUND", "That event does not exist.");
    const [[role]] = await pool.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, found.row.club_id]);
    if (!is_committee(role)) throw new ApiError("FORBIDDEN", "Only the club committee can change the cover.");
    if (Number(found.row.version) !== expected_version) throw new ApiError("STALE_VERSION", "This event changed. Refresh and try again.");
    if (!["draft", "published"].includes(found.row.status)) throw new ApiError("INVALID_STATE", "This event’s cover can’t be changed.");
    return found.row;
  }

  async function commit(req, id, expected_version, { key, alt }) {
    const now = clock();
    const old = await with_transaction(pool, async (conn) => {
      const [[event]] = await conn.query("SELECT id, version, status, cover_key FROM events WHERE id = ? FOR UPDATE", [id]);
      if (Number(event.version) !== expected_version) throw new ApiError("STALE_VERSION", "This event changed. Refresh and try again.");
      if (!["draft", "published"].includes(event.status)) throw new ApiError("INVALID_STATE", "This event’s cover can’t be changed.");
      await conn.query("UPDATE events SET cover_key = ?, cover_alt = ?, cover_updated_at = ?, version = version + 1 WHERE id = ?", [key ?? null, key ? alt : null, key ? to_db(now) : null, id]);
      await audit(conn, { actor: req.user.id, entity_type: "event", entity_id: id, action: key ? "event.cover_set" : "event.cover_removed", now });
      return event.cover_key;
    });
    return old;
  }

  define_route(router, "/events/:event_id/cover", {
    put: [require_user, cover_upload(), wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const fields = parse_cover_fields(req.body);
      limiter.hit(`cover:${req.user.id}`);
      await guard(req, id, fields.expected_version);
      const { key } = await store_cover(cover_dir, req.file?.buffer);
      try {
        const old = await commit(req, id, fields.expected_version, { key, alt: fields.alt });
        if (old) await delete_cover_files(cover_dir, old);
      } catch (error) {
        await delete_cover_files(cover_dir, key);
        throw error;
      }
      res.json({ data: (await load_event(pool, req.user, id, clock())).dto });
    })],
    delete: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const body = validate_body(req.body, { expected_version: { kind: "int", min: 1, required: true } });
      await guard(req, id, body.expected_version);
      const old = await commit(req, id, body.expected_version, {});
      if (old) await delete_cover_files(cover_dir, old);
      res.json({ data: (await load_event(pool, req.user, id, clock())).dto });
    })],
  });

  define_route(router, "/events/:event_id/cover/:size", {
    get: [require_user, wrap(async (req, res) => {
      const id = id_param(req, "event_id");
      const found = await load_event(pool, req.user, id, clock());
      const size = req.params.size;
      const [[row]] = await pool.query("SELECT cover_key FROM events WHERE id = ?", [id]);
      if (!found || !row?.cover_key || !["card", "full"].includes(size) || !KEY_PATTERN.test(row.cover_key)) throw new ApiError("NOT_FOUND", "That cover does not exist.");
      const etag = `"${row.cover_key}-${size}"`;
      res.set({ "Cache-Control": "private, max-age=86400", ETag: etag, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" });
      if (req.get("if-none-match") === etag) return res.status(304).end();
      const path = file_path(cover_dir, row.cover_key, size);
      try {
        res.set("Content-Length", String((await stat(path)).size));
      } catch {
        throw new ApiError("NOT_FOUND", "That cover does not exist.");
      }
      createReadStream(path).pipe(res);
    })],
  });

  return router;
}

export { IS_COVER_UPLOAD, create_covers_router };
