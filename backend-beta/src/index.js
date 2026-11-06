import express from "express";
import session from "express-session";
import mysqlSession from "express-mysql-session";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import pool from "./config/db.js";
import { verifyWorkflowSchema } from "./config/schema.js";
import health_routes from "./features/health/health.routes.js";
import v1_notifications from "./features/notifications/v1.routes.js";
import v1_users from "./features/users/v1.routes.js";
import v1_events from "./features/events/v1.routes.js";
import v1_bookings from "./features/events/v1.bookings.js";
import v1_reports from "./features/clubs/v1.reports.js";
import v1_venues from "./features/venues/v1.routes.js";
import v1_clubs from "./features/clubs/v1.routes.js";

const app = express();
const app_origin = process.env.APP_ORIGIN || (process.env.NODE_ENV !== "production" ? "http://localhost:5173" : "");
if (!app_origin || !/^https?:\/\//.test(app_origin) || new URL(app_origin).origin !== app_origin) {
  throw new Error("Set APP_ORIGIN to the exact public origin, for example http://localhost:5173.");
}
const session_secret =
  process.env.SESSION_SECRET || randomBytes(32).toString("hex");

if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32)) {
  throw new Error("Set SESSION_SECRET to at least 32 random bytes in production.");
}

if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET is unset; logins will expire when the API restarts.",
  );
}
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use((req, res, next) => { req.id = randomUUID(); res.setHeader("X-Request-Id", req.id); next(); });
app.use((req, res, next) => {
  if (!/^\/api\/(?:auth|profile|events|venues|bookings|clubs|memberships|notifications)(?:\/|$)/.test(req.path)) return next();
  return res.status(410).json({ error: { code: "API_VERSION_RETIRED", message: "This API version has been retired. Use /api/v1.", fields: {}, request_id: req.id } });
});
app.use(express.json({ limit: "64kb" }));
const MySQLStore = mysqlSession(session);
const sessionStore = new MySQLStore({ createDatabaseTable: false, expiration: 8 * 60 * 60 * 1000,
  checkExpirationInterval: 15 * 60 * 1000 }, pool);
app.use(
  session({
    name: "clubspace.sid",
    secret: session_secret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production" &&
        process.env.SESSION_COOKIE_SECURE !== "false",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);
app.get("/api/v1/auth/csrf", (req, res) => {
  if (!req.session.csrf_token) req.session.csrf_token = randomBytes(32).toString("hex");
  req.session.save(error => {
    if (error) return res.status(503).json(req.path.startsWith("/api/v1/")
      ? { error: { code: "DATABASE_UNAVAILABLE", message: "Unable to create session.", fields: {}, request_id: req.id } }
      : { message: "Unable to create session." });
    return res.json(req.path.startsWith("/api/v1/") ? { data: { csrf_token: req.session.csrf_token } } : { csrf_token: req.session.csrf_token });
  });
});
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const reject = (status, code, message) => req.path.startsWith("/api/v1/")
    ? res.status(status).json({ error: { code, message, fields: {}, request_id: req.id } })
    : res.status(status).json({ message, code });
  if (req.get("origin") !== app_origin) return reject(403, "ORIGIN_INVALID", "Request origin is not allowed.");
  if (!req.is("application/json")) return reject(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json for this request.");
  const supplied = req.get("x-csrf-token") || "";
  const expected = req.session?.csrf_token || "";
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) return reject(403, "CSRF_INVALID", "Session token is missing or expired.");
  return next();
});
app.use(health_routes);
app.use("/api/v1", v1_notifications);
app.use("/api/v1", v1_users);
app.use("/api/v1", v1_events);
app.use("/api/v1", v1_bookings);
app.use("/api/v1", v1_reports);
app.use("/api/v1", v1_venues);
app.use("/api/v1", v1_clubs);
app.use("/api/v1", (req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found.", fields: {}, request_id: req.id } }));
app.use("/api", (req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found.", fields: {}, request_id: req.id } }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.type === "entity.too.large" ? 413 : err.type === "entity.parse.failed" ? 400 : 500;
  const code = status === 413 ? "PAYLOAD_TOO_LARGE" : status === 400 ? "INVALID_JSON" : "INTERNAL_ERROR";
  const message = status === 413 ? "Request body is too large." : status === 400 ? "Invalid JSON body." : "Request could not be completed.";
  return res.status(status).json(req.path.startsWith("/api/v1/") ? { error: { code, message, fields: {}, request_id: req.id } } : { message });
});

const port = Number(process.env.PORT || 3000);

async function start() {
  try {
    await verifyWorkflowSchema(pool);
    await pool.query("SELECT session_id,expires,data FROM sessions LIMIT 0");
    await pool.query("SELECT platform_role FROM users LIMIT 0");
    await pool.query("SELECT version,requested_by,decided_by FROM bookings LIMIT 0");
    await pool.query("SELECT version,registration_closes_at FROM events LIMIT 0");
    await pool.query("SELECT action_key,lock_token FROM notification_jobs LIMIT 0");
    await pool.query("SELECT action_id FROM participation_history LIMIT 0");
    await pool.query("SELECT last_registered_at,queued_at,confirmed_at FROM participations LIMIT 0");
    await pool.query("SELECT action_id FROM audit_logs LIMIT 0");
    await pool.query("SELECT dedup_key,type,booking_id FROM notifications LIMIT 0");
    app.listen(port, () => console.log(`API on http://localhost:${port}`));
  } catch (error) {
    console.error("MySQL connection or required schema is unavailable. Check configuration and apply the documented migrations.");
    console.error(error.message);
    process.exit(1);
  }
}

start();
