import pool from "../config/db.js";
try {
  const [[row]] = await pool.query(`SELECT EXISTS(SELECT 1 FROM worker_heartbeats
    WHERE last_seen_at > DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 120 SECOND)) AS healthy`);
  if (!row.healthy) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { await pool.end(); }
