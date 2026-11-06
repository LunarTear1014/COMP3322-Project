import { Router } from "express";
import { randomBytes } from "node:crypto";
import { get_current_user, login_user, register_user } from "./users.service.js";
import { list_memberships } from "../clubs/clubs.service.js";
import { update_user_profile } from "./users.repository.js";

const router = Router();
const error = (req, res, status, code, message, fields = {}) => res.status(status).json({ error: { code, message, fields, request_id: req.id } });
const objectWithKeys = (body, allowed) => body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every(key => allowed.includes(key));
const sessionAction = (session, method) => new Promise((resolve, reject) => session[method](err => err ? reject(err) : resolve()));
const membershipsFor = async userId => (await list_memberships(userId)).map(row => ({
  club_id: row.club_id, club_name: row.name, role: row.role === "president" ? "committee" : row.role, joined_at: row.joined_epoch == null ? null : new Date(Number(row.joined_epoch) * 1000).toISOString(),
}));

router.get("/config", (_req, res) => res.json({ data: { campus_timezone: "Asia/Hong_Kong", slots: [
  { id: "morning", start: "10:00", end: "12:00" }, { id: "afternoon", start: "13:00", end: "15:00" }, { id: "evening", start: "16:00", end: "18:00" },
] } }));

router.post("/auth/register", async (req, res) => {
  const body = req.body;
  if (!objectWithKeys(body, ["name", "email", "student_id", "password"]) ||
      typeof body.name !== "string" || !body.name.trim() || [...body.name.trim()].length > 100 ||
      typeof body.email !== "string" || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
      typeof body.student_id !== "string" || !/^[A-Za-z0-9-]{1,50}$/.test(body.student_id) ||
      typeof body.password !== "string" || [...body.password].length < 12 || [...body.password].length > 128) {
    return error(req, res, 422, "VALIDATION_FAILED", "Provide a valid name, email, student ID and password of 12 to 128 characters.");
  }
  try {
    const result = await register_user({ name: body.name.trim(), email: body.email.trim().toLowerCase(), student_id: body.student_id, password: body.password });
    if (!result.ok) return error(req, res, 409, result.reason === "duplicate_student_id" ? "STUDENT_ID_IN_USE" : "EMAIL_IN_USE", "That account detail is already in use.");
    return res.status(201).json({ data: result.user });
  } catch { return error(req, res, 503, "DATABASE_UNAVAILABLE", "Account registration is temporarily unavailable."); }
});

router.post("/auth/login", async (req, res) => {
  const body = req.body;
  if (!objectWithKeys(body, ["email", "password"]) || typeof body.email !== "string" || !body.email.trim() || body.email.trim().length > 254 || typeof body.password !== "string" || !body.password || [...body.password].length > 128) {
    return error(req, res, 422, "VALIDATION_FAILED", "Provide an email and password.");
  }
  try {
    const user = await login_user(body.email.trim().toLowerCase(), body.password);
    if (!user) return error(req, res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    await sessionAction(req.session, "regenerate");
    req.session.user_id = user.id;
    req.session.csrf_token = randomBytes(32).toString("hex");
    await sessionAction(req.session, "save");
    return res.json({ data: { user, memberships: await membershipsFor(user.id), csrf_token: req.session.csrf_token } });
  } catch { return error(req, res, 503, "DATABASE_UNAVAILABLE", "Sign-in is temporarily unavailable."); }
});

router.get("/auth/session", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  try {
    const user = await get_current_user(req.session.user_id);
    if (!user) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    return res.json({ data: { user, memberships: await membershipsFor(user.id), csrf_token: req.session.csrf_token } });
  } catch { return error(req, res, 503, "DATABASE_UNAVAILABLE", "Session is temporarily unavailable."); }
});

router.get("/profile", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  try {
    const user = await get_current_user(req.session.user_id);
    if (!user) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    return res.json({ data: user });
  } catch { return error(req, res, 503, "DATABASE_UNAVAILABLE", "Profile is temporarily unavailable."); }
});

router.patch("/profile", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  const body = req.body;
  if (!objectWithKeys(body, ["name", "email"]) || !Object.keys(body).length ||
      (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || [...body.name.trim()].length > 100)) ||
      (body.email !== undefined && (typeof body.email !== "string" || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())))) {
    return error(req, res, 422, "VALIDATION_FAILED", "Provide a valid name or email.");
  }
  try {
    const result = await update_user_profile(req.session.user_id, { name: body.name?.trim(), email: body.email?.trim().toLowerCase() });
    if (result.reason === "duplicate_email") return error(req, res, 409, "EMAIL_IN_USE", "That email is already in use.");
    if (!result.ok) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    return res.json({ data: await get_current_user(req.session.user_id) });
  } catch { return error(req, res, 503, "DATABASE_UNAVAILABLE", "Profile is temporarily unavailable."); }
});

router.post("/auth/logout", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) return error(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  if (!objectWithKeys(req.body, []) || Object.keys(req.body).length) return error(req, res, 422, "VALIDATION_FAILED", "Provide an empty object.");
  try { await sessionAction(req.session, "destroy"); res.clearCookie("clubspace.sid"); return res.status(204).end(); }
  catch { return error(req, res, 503, "DATABASE_UNAVAILABLE", "Sign-out is temporarily unavailable."); }
});

for (const [path, allow] of [["/config", "GET, HEAD"], ["/auth/csrf", "GET, HEAD"], ["/auth/register", "POST"],
  ["/auth/login", "POST"], ["/auth/session", "GET, HEAD"], ["/auth/logout", "POST"], ["/profile", "GET, HEAD, PATCH"]]) {
  router.all(path, (req, res) => { res.setHeader("Allow", allow); return error(req, res, 405, "METHOD_NOT_ALLOWED", "Method not allowed."); });
}

export default router;
