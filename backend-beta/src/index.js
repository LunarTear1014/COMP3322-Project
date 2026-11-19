import { randomBytes } from "node:crypto";
import pool from "./config/db.js";
import { create_app } from "./app.js";
import { assert_schema_version } from "./db/migrate.js";
import { create_utc_pool } from "./db/pool.js";
import { MysqlSessionStore } from "./api_v1/session_store.js";
import { create_v1_stack } from "./api_v1/stack.js";
import { create_google_client } from "./api_v1/google_setup.js";
import health_routes from "./features/health/health.routes.js";
import events_routes from "./features/events/events.routes.js";
import venues_routes from "./features/venues/venues.routes.js";
import users_routes from "./features/users/users.routes.js";
import clubs_routes from "./features/clubs/clubs.routes.js";

const production = process.env.NODE_ENV === "production";
const session_secret =
  process.env.SESSION_SECRET || randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET is unset; logins will expire when the API restarts.",
  );
}
if (production && !process.env.APP_ORIGIN) {
  console.warn(
    "APP_ORIGIN is unset; /api/v1 mutations are rejected until it is set.",
  );
}

const app_origin = process.env.APP_ORIGIN || (production ? undefined : "http://localhost:5173");

// Browsers only send Secure cookies over HTTPS, so by default the session
// cookie is Secure exactly when the site is served over https://.
// SESSION_COOKIE_SECURE=true or false overrides that.
const cookie_secure_override = process.env.SESSION_COOKIE_SECURE;
const cookie_secure = production && (cookie_secure_override
  ? cookie_secure_override !== "false"
  : Boolean(app_origin?.startsWith("https://")));

// v1 runs on its own UTC pool and a MySQL session store; the legacy routes
// share the same session (and cookie), so signing in on either authenticates both.
const v1_pool = create_utc_pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
const google_client = create_google_client({
  client_id: process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
});
const stack = create_v1_stack({ pool: v1_pool, google_client, app_origin });

const app = create_app({
  google_oauth_enabled: stack.google_oauth_enabled,
  session_store: new MysqlSessionStore({ pool: v1_pool }),
  v1_routers: stack.routers,
  legacy_google_mounts: stack.extra_mounts,
  is_multipart_route: stack.is_multipart_route,
  session_secret,
  app_origin,
  cookie_secure,
  trust_proxy: production,
  legacy_routers: [
    health_routes,
    events_routes,
    venues_routes,
    users_routes,
    clubs_routes,
  ],
});

const port = Number(process.env.PORT || 3000);

async function start() {
  try {
    await pool.query("SELECT 1");
    await assert_schema_version(v1_pool, "023_view_membership");
    await stack.start();
    app.listen(port, () => console.log(`API on http://localhost:${port}`));
  } catch (error) {
    console.error("Could not connect to MySQL. Check .env and start MySQL.");
    console.error(error.message);
    process.exit(1);
  }
}

start();
