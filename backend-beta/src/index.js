import express from "express";
import session from "express-session";
import { randomBytes } from "node:crypto";
import pool from "./config/db.js";
import health_routes from "./features/health/health.routes.js";
import events_routes from "./features/events/events.routes.js";
import venues_routes from "./features/venues/venues.routes.js";
import users_routes from "./features/users/users.routes.js";
import clubs_routes from "./features/clubs/clubs.routes.js";

const app = express();
const session_secret =
  process.env.SESSION_SECRET || randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET is unset; logins will expire when the API restarts.",
  );
}
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(express.json());
app.use(
  session({
    name: "clubspace.sid",
    secret: session_secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(health_routes);
app.use(events_routes);
app.use(venues_routes);
app.use(users_routes);
app.use(clubs_routes);

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
