import express from "express";
import { with_transaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import { PAGE_QUERY, pagination, validate_body, validate_query } from "../shared/validate.js";
import { define_route } from "./router.js";
import { audit, id_param, membership_dto, notify, page_meta, require_admin, require_user, to_db, wrap } from "./common.js";

const WAITING = "('waitlisted', 'pending')";

async function committee_of(db, user_id, club_id, { lock = false } = {}) {
  const [rows] = await db.query(
    `SELECT role, version FROM memberships WHERE user_id = ? AND club_id = ?${lock ? " FOR UPDATE" : ""}`, [user_id, club_id]);
  return rows[0] || null;
}
const is_committee = (membership) => ["committee", "president"].includes(membership?.role);

async function committee_ids(db, club_id) {
  const [rows] = await db.query("SELECT user_id FROM memberships WHERE club_id = ? AND role IN ('committee', 'president')", [club_id]);
  return rows.map((row) => row.user_id);
}

const MEMBER_PATCH = { role: { kind: "enum", values: ["member", "committee"], required: true }, expected_version: { kind: "int", min: 1, required: true } };
const PRESIDENCY = { to_user_id: { kind: "int", min: 1, required: true }, expected_version: { kind: "int", min: 1, required: true } };
const TAG_BODY = { name: { kind: "string", min: 1, max: 24, required: true } };
const CAMPUS_TAG = { slug: { kind: "string", min: 1, max: 32, required: true, lowercase: true, pattern: /^[a-z0-9-]+$/ }, name: { kind: "string", min: 1, max: 40, required: true } };
const CAMPUS_TAG_PATCH = { name: { kind: "string", min: 1, max: 40 }, retired: { kind: "bool" } };

// Clubs, memberships, governance (president-only role changes), venues and tags.
function create_clubs_router({ pool, clock }) {
  const router = express.Router();

  define_route(router, "/clubs", {
    get: [require_user, wrap(async (req, res) => {
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM clubs");
      const [rows] = await pool.query(
        `SELECT c.id, c.name, c.description, m.role AS my_role FROM clubs c
         LEFT JOIN memberships m ON m.club_id = c.id AND m.user_id = ? ORDER BY c.id LIMIT ? OFFSET ?`,
        [req.user.id, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map((row) => ({ id: row.id, name: row.name, description: row.description, my_role: row.my_role })), meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/me/memberships", {
    get: [require_user, wrap(async (req, res) => {
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM memberships WHERE user_id = ?", [req.user.id]);
      const [rows] = await pool.query(
        `SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id
         WHERE m.user_id = ? ORDER BY m.club_id LIMIT ? OFFSET ?`, [req.user.id, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map(membership_dto), meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/clubs/:club_id/membership", {
    put: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        const existing = await committee_of(conn, req.user.id, club_id, { lock: true });
        let created = false;
        if (!existing) {
          await conn.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'member')", [req.user.id, club_id]);
          await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "member.joined", details: { user_id: req.user.id }, now: clock() });
          created = true;
        }
        const [[row]] = await conn.query(
          `SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? AND m.club_id = ?`, [req.user.id, club_id]);
        return { created, membership: membership_dto(row) };
      });
      res.status(result.created ? 201 : 200).json({ data: result.membership });
    })],
    delete: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        const membership = await committee_of(conn, req.user.id, club_id, { lock: true });
        if (!membership) return;
        if (membership.role === "president") throw new ApiError("PRESIDENT_TRANSFER_REQUIRED", "Transfer the presidency before leaving the club.");
        if (membership.role === "committee") throw new ApiError("COMMITTEE_MEMBERSHIP_PROTECTED", "Committee members can’t leave here. Ask the president to change your role first.");
        const [blocking] = await conn.query(
          `SELECT 1 FROM participations p JOIN events e ON e.id = p.event_id
           WHERE p.user_id = ? AND e.club_id = ? AND e.visibility = 'members_only' AND e.status = 'published' AND e.start_time > ?
             AND p.status IN ('joined', 'waitlisted', 'pending') LIMIT 1`, [req.user.id, club_id, to_db(clock())]);
        if (blocking.length) throw new ApiError("ACTIVE_MEMBER_REGISTRATIONS", "Withdraw from this club’s members-only events before leaving.");
        await conn.query("DELETE FROM memberships WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "member.left", details: { user_id: req.user.id }, now: clock() });
      });
      res.status(204).end();
    })],
  });

  define_route(router, "/clubs/:club_id/members", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const query = pagination(validate_query(req.query, { ...PAGE_QUERY, role: { kind: "enum", values: ["member", "committee", "president"] } }));
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", mine ? "Only the committee can see members." : "That club does not exist.");
      const role = validate_query(req.query, { ...PAGE_QUERY, role: { kind: "enum", values: ["member", "committee", "president"] } }).role ?? null;
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM memberships WHERE club_id = ? AND (? IS NULL OR role = ?)", [club_id, role, role]);
      const [rows] = await pool.query(
        `SELECT m.user_id, u.name, m.role, m.version, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.club_id = ? AND (? IS NULL OR m.role = ?) ORDER BY FIELD(m.role, 'president', 'committee', 'member'), m.user_id LIMIT ? OFFSET ?`,
        [club_id, role, role, query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map((row) => ({ club_id, role: row.role, version: row.version, joined_at: row.joined_at, user: { id: row.user_id, name: row.name } })), meta: page_meta(total, query) });
    })],
  });

  define_route(router, "/clubs/:club_id/members/:user_id", {
    patch: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const target_id = id_param(req, "user_id");
      const body = validate_body(req.body, MEMBER_PATCH);
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        const actor = club && await committee_of(conn, req.user.id, club_id, { lock: true });
        if (!club || !actor) throw new ApiError("NOT_FOUND", "That club does not exist.");
        if (actor.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can change roles.");
        const target = await committee_of(conn, target_id, club_id, { lock: true });
        if (!target) throw new ApiError("NOT_FOUND", "That person is not a member.");
        if (target.role === "president") throw new ApiError("FORBIDDEN", "Transfer the presidency instead.");
        if (Number(target.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This member changed. Refresh and try again.");
        if (target.role !== body.role) {
          await conn.query("UPDATE memberships SET role = ?, version = version + 1 WHERE user_id = ? AND club_id = ?", [body.role, target_id, club_id]);
          const now = clock();
          await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "role.changed", details: { user_id: target_id, from: target.role, to: body.role }, now });
          const committee = await committee_ids(conn, club_id);
          await notify(conn, {
            users: [target_id, ...committee], type: "role_changed", club_id, now, exclude: req.user.id,
            key: `role_changed:${club_id}:${target_id}:${Number(target.version) + 1}`,
            title: `Role change in ${club.name}`, body: body.role === "committee" ? "A member joined the committee." : "A committee member returned to member.",
          });
        }
        const [[row]] = await conn.query(
          "SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? AND m.club_id = ?", [target_id, club_id]);
        return membership_dto(row);
      });
      res.json({ data: result });
    })],
  });

  define_route(router, "/clubs/:club_id/presidency", {
    post: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const body = validate_body(req.body, PRESIDENCY);
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        // Lock both membership rows in ascending user_id order.
        const ids = [req.user.id, body.to_user_id].sort((a, b) => a - b);
        const [rows] = await conn.query("SELECT user_id, role, version FROM memberships WHERE club_id = ? AND user_id IN (?) ORDER BY user_id FOR UPDATE", [club_id, ids]);
        const mine = rows.find((row) => row.user_id === req.user.id);
        const to = rows.find((row) => row.user_id === body.to_user_id);
        if (!mine) throw new ApiError("NOT_FOUND", "That club does not exist.");
        if (mine.role !== "president") throw new ApiError("FORBIDDEN", "Only the president can transfer the presidency.");
        if (!to) throw new ApiError("NOT_FOUND", "That person is not a member.");
        if (to.user_id === req.user.id || to.role !== "committee") throw new ApiError("INVALID_STATE", "Choose a committee member as the next president.");
        if (Number(to.version) !== body.expected_version) throw new ApiError("STALE_VERSION", "This member changed. Refresh and try again.");
        await conn.query("UPDATE memberships SET role = 'committee', version = version + 1 WHERE user_id = ? AND club_id = ?", [req.user.id, club_id]);
        await conn.query("UPDATE memberships SET role = 'president', version = version + 1 WHERE user_id = ? AND club_id = ?", [to.user_id, club_id]);
        const now = clock();
        await audit(conn, { actor: req.user.id, entity_type: "membership", entity_id: club_id, action: "presidency.transferred", details: { from: req.user.id, to: to.user_id }, now });
        await notify(conn, {
          users: await committee_ids(conn, club_id), type: "role_changed", club_id, now, exclude: req.user.id,
          key: `presidency:${club_id}:${to.user_id}:${Number(to.version) + 1}`, title: `New president of ${club.name}`, body: "The presidency was transferred.",
        });
        const read = async (user_id) => {
          const [[row]] = await conn.query("SELECT m.club_id, c.name AS club_name, m.role, m.version, m.joined_at FROM memberships m JOIN clubs c ON c.id = m.club_id WHERE m.user_id = ? AND m.club_id = ?", [user_id, club_id]);
          return membership_dto(row);
        };
        return { previous: await read(req.user.id), current: await read(to.user_id) };
      });
      res.json({ data: result });
    })],
  });

  // Venues
  define_route(router, "/venues", {
    get: [require_user, wrap(async (req, res) => {
      const query = pagination(validate_query(req.query, PAGE_QUERY));
      const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM venues");
      const [rows] = await pool.query("SELECT id, name, location, description, capacity, is_active FROM venues ORDER BY id LIMIT ? OFFSET ?", [query.page_size, (query.page - 1) * query.page_size]);
      res.json({ data: rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) })), meta: page_meta(total, query) });
    })],
  });

  // Tags
  define_route(router, "/tags", {
    get: [require_user, wrap(async (_req, res) => {
      const [rows] = await pool.query("SELECT id, slug, name FROM campus_tags WHERE retired_at IS NULL ORDER BY name");
      res.json({ data: rows });
    })],
    post: [require_admin, wrap(async (req, res) => {
      const body = validate_body(req.body, CAMPUS_TAG);
      try {
        const [result] = await pool.query("INSERT INTO campus_tags (slug, name) VALUES (?, ?)", [body.slug, body.name]);
        res.status(201).json({ data: { id: result.insertId, slug: body.slug, name: body.name } });
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY") throw new ApiError("VALIDATION_FAILED", "That tag already exists.", { fields: { slug: "Already in use." } });
        throw error;
      }
    })],
  });
  define_route(router, "/tags/:tag_id", {
    patch: [require_admin, wrap(async (req, res) => {
      const tag_id = id_param(req, "tag_id");
      const body = validate_body(req.body, CAMPUS_TAG_PATCH, { at_least_one_of: ["name", "retired"] });
      const [result] = await pool.query(
        "UPDATE campus_tags SET name = COALESCE(?, name), retired_at = CASE WHEN ? IS NULL THEN retired_at WHEN ? THEN COALESCE(retired_at, ?) ELSE NULL END WHERE id = ?",
        [body.name ?? null, body.retired ?? null, body.retired ?? null, to_db(clock()), tag_id]);
      if (!result.affectedRows) throw new ApiError("NOT_FOUND", "That tag does not exist.");
      const [[row]] = await pool.query("SELECT id, slug, name FROM campus_tags WHERE id = ?", [tag_id]);
      res.json({ data: row });
    })],
  });

  define_route(router, "/clubs/:club_id/tags", {
    get: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const [rows] = await pool.query("SELECT id, name FROM club_tags WHERE club_id = ? ORDER BY name_key", [club_id]);
      res.json({ data: rows });
    })],
    post: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const body = validate_body(req.body, TAG_BODY);
      const result = await with_transaction(pool, async (conn) => {
        const [[club]] = await conn.query("SELECT id, name FROM clubs WHERE id = ? FOR UPDATE", [club_id]);
        if (!club) throw new ApiError("NOT_FOUND", "That club does not exist.");
        const mine = await committee_of(conn, req.user.id, club_id);
        if (!is_committee(mine)) throw new ApiError("FORBIDDEN", "Only the committee can add club tags.");
        const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM club_tags WHERE club_id = ?", [club_id]);
        if (Number(n) >= 30) throw new ApiError("VALIDATION_FAILED", "A club can have at most 30 tags.", { fields: { name: "Too many tags." } });
        try {
          const [insert] = await conn.query("INSERT INTO club_tags (club_id, name) VALUES (?, ?)", [club_id, body.name]);
          const now = clock();
          await notify(conn, { users: await committee_ids(conn, club_id), type: "club_updated", club_id, now, exclude: req.user.id, key: `club_tag:${insert.insertId}`, title: `${club.name} tags changed`, body: `Tag “${body.name}” was added.` });
          return { id: insert.insertId, name: body.name };
        } catch (error) {
          if (error.code === "ER_DUP_ENTRY") throw new ApiError("VALIDATION_FAILED", "That tag already exists.", { fields: { name: "Already in use." } });
          throw error;
        }
      });
      res.status(201).json({ data: result });
    })],
  });
  define_route(router, "/clubs/:club_id/tags/:tag_id", {
    delete: [require_user, wrap(async (req, res) => {
      const club_id = id_param(req, "club_id");
      const tag_id = id_param(req, "tag_id");
      const mine = await committee_of(pool, req.user.id, club_id);
      if (!is_committee(mine)) throw new ApiError(mine ? "FORBIDDEN" : "NOT_FOUND", "Only the committee can remove club tags.");
      await pool.query("DELETE FROM club_tags WHERE id = ? AND club_id = ?", [tag_id, club_id]);
      res.status(204).end();
    })],
  });

  return router;
}

export { WAITING, committee_ids, committee_of, create_clubs_router, is_committee };
