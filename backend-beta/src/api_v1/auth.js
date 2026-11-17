import express from "express";
import { rotate_csrf_token } from "../middleware/csrf.js";
import { ApiError } from "../shared/errors.js";
import { validate_body } from "../shared/validate.js";
import { define_route } from "./router.js";
import { load_memberships, require_user, user_dto, wrap } from "./common.js";

const REGISTER = {
  name: { kind: "string", min: 1, max: 100, required: true },
  email: { kind: "string", min: 3, max: 254, required: true, lowercase: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, pattern_message: "Enter a valid email address." },
  student_id: { kind: "string", min: 1, max: 50, required: true, pattern: /^[A-Za-z0-9-]+$/, pattern_message: "Use letters, digits and hyphens only." },
  password: { kind: "string", min: 12, max: 128, required: true, trim: false },
};
const LOGIN = {
  email: { kind: "string", min: 1, max: 254, required: true, lowercase: true },
  password: { kind: "string", min: 1, max: 128, required: true, trim: false },
};
const PROFILE = {
  name: { kind: "string", min: 1, max: 100 },
  email: { ...REGISTER.email, required: false },
};

const ip_of = (req) => req.ip || req.socket?.remoteAddress || "unknown";

const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
const save = (req) => new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
const destroy = (req) => new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));

function duplicate_error(error) {
  if (error?.code !== "ER_DUP_ENTRY") return null;
  if (/student_id/.test(error.sqlMessage)) return new ApiError("STUDENT_ID_IN_USE", "That student ID already has an account.", { fields: { student_id: "Already in use." } });
  return new ApiError("EMAIL_IN_USE", "That email already has an account.", { fields: { email: "Already in use." } });
}

// Auth, session and profile endpoints. `hasher` and the two throttles are
// injected so tests can use cheap parameters.
function create_auth_router({ pool, hasher, login_throttle, register_throttle, ip_throttle }) {
  const router = express.Router();

  define_route(router, "/auth/register", {
    post: wrap(async (req, res) => {
      ip_throttle.hit(`register:${ip_of(req)}`);
      register_throttle.hit(`reg:${ip_of(req)}`);
      const body = validate_body(req.body, REGISTER);
      const password_hash = await hasher.hash(body.password);
      try {
        const [result] = await pool.query(
          "INSERT INTO users (email, password_hash, name, student_id) VALUES (?, ?, ?, ?)",
          [body.email, password_hash, body.name, body.student_id]);
        const [[row]] = await pool.query("SELECT id, name, email, student_id, platform_role FROM users WHERE id = ?", [result.insertId]);
        res.status(201).json({ data: user_dto(row) });
      } catch (error) {
        throw duplicate_error(error) ?? error;
      }
    }),
  });

  define_route(router, "/auth/login", {
    post: wrap(async (req, res) => {
      const body = validate_body(req.body, LOGIN);
      ip_throttle.hit(`login:${ip_of(req)}`);
      login_throttle.hit(`${body.email}|${ip_of(req)}`);
      const [rows] = await pool.query("SELECT id, name, email, student_id, platform_role, password_hash FROM users WHERE LOWER(TRIM(email)) = ?", [body.email]);
      const user = rows[0];
      // Unknown email and sentinel (Google-only user) both still spend a full
      // derivation (dummy path), same generic error.
      const verdict = await hasher.verify(body.password, user?.password_hash ?? null);
      if (!user || !verdict.ok) throw new ApiError("INVALID_CREDENTIALS", "Email or password is incorrect.");
      if (verdict.needs_rehash) {
        await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [await hasher.hash(body.password), user.id]);
      }
      login_throttle.reset(`${body.email}|${ip_of(req)}`);
      await regenerate(req);
      req.session.user_id = user.id;
      const csrf_token = rotate_csrf_token(req);
      await save(req);
      res.json({ data: { user: user_dto(user), memberships: await load_memberships(pool, user.id), csrf_token } });
    }),
  });

  define_route(router, "/auth/session", {
    get: [require_user, wrap(async (req, res) => {
      res.json({ data: { user: user_dto(req.user), memberships: await load_memberships(pool, req.user.id), csrf_token: req.session.csrf_token } });
    })],
  });

  define_route(router, "/auth/logout", {
    post: [require_user, wrap(async (req, res) => {
      await destroy(req);
      res.clearCookie("clubspace.sid");
      res.status(204).end();
    })],
  });

  define_route(router, "/profile", {
    get: [require_user, (req, res) => res.json({ data: user_dto(req.user) })],
    patch: [require_user, wrap(async (req, res) => {
      const body = validate_body(req.body, PROFILE, { at_least_one_of: ["name", "email"] });
      try {
        await pool.query("UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?", [body.name ?? null, body.email ?? null, req.user.id]);
      } catch (error) {
        throw duplicate_error(error) ?? error;
      }
      const [[row]] = await pool.query("SELECT id, name, email, student_id, platform_role FROM users WHERE id = ?", [req.user.id]);
      res.json({ data: user_dto(row) });
    })],
  });

  return router;
}

export { create_auth_router };
