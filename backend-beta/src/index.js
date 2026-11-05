import express from "express";
import pool from "./config/db.js";
import health_routes from "./features/health/health.routes.js";
import events_routes from "./features/events/events.routes.js";
import venues_routes from "./features/venues/venues.routes.js";
import profile_routes from "./features/profile/profile.routes.js";

const app = express();
app.use(express.json());
app.use(health_routes);
app.use(events_routes);
app.use(venues_routes);
app.use(profile_routes);

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
