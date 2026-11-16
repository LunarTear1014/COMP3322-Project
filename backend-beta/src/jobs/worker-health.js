// Compose healthcheck for the worker: healthy while any worker wrote a
// heartbeat in the last 120 seconds. Exit code 1 means unhealthy.
//   node src/jobs/worker-health.js
import { create_utc_pool } from "../db/pool.js";

const pool = create_utc_pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connection_limit: 1,
});
try {
  const [[row]] = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE last_seen_at > DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 120 SECOND)) AS healthy");
  if (!Number(row.healthy)) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
