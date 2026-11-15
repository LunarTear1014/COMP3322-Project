import { randomBytes } from "node:crypto";
import pool from "./config/db.js";
import { create_app } from "./app.js";
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

const app = create_app({
  session_secret,
  app_origin: process.env.APP_ORIGIN || (production ? undefined : "http://localhost:5173"),
  cookie_secure: production && process.env.SESSION_COOKIE_SECURE !== "false",
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
    app.listen(port, () => console.log(`API on http://localhost:${port}`));
  } catch (error) {
    console.error("Could not connect to MySQL. Check .env and start MySQL.");
    console.error(error.message);
    process.exit(1);
  }
}

start();
