// Notification worker: one supported process (docker compose service `worker`).
//   node src/worker.js
// Polls every 5 s, scans reminders and digests every 60 s, runs daily
// maintenance, writes a heartbeat, and stops cleanly on SIGTERM within 30 s.
import { randomUUID } from "node:crypto";
import { create_utc_pool } from "./db/pool.js";
import { assert_schema_version } from "./db/migrate.js";
import { maintenance, run_once, scan_digests, scan_reminders } from "./jobs/handlers.js";
import { sweep_orphan_covers } from "./features/covers/cover_service.js";
import { to_mysql_utc } from "./shared/slots.js";

const POLL_MS = 5000;
const SCAN_MS = 60_000;
const DAY_MS = 86_400_000;

async function heartbeat(pool, worker_id, now) {
  await pool.query(
    "INSERT INTO worker_heartbeats (worker_id, last_seen_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)", [worker_id, to_mysql_utc(now)]);
}

async function run_worker({ pool, clock = () => new Date(), cover_dir = process.env.COVER_DIR || "./data/covers", logger = console }) {
  const worker_id = `w-${randomUUID().slice(0, 8)}`;
  let stopping = false;
  let last_scan = 0;
  let last_maintenance = 0;
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  logger.log(`worker ${worker_id} started`);
  while (!stopping) {
    const now = clock();
    try {
      await heartbeat(pool, worker_id, now);
      if (now.getTime() - last_scan >= SCAN_MS) {
        last_scan = now.getTime();
        await scan_reminders(pool, now);
        await scan_digests(pool, now);
      }
      if (now.getTime() - last_maintenance >= DAY_MS) {
        last_maintenance = now.getTime();
        await maintenance(pool, now);
        const [rows] = await pool.query("SELECT cover_key FROM events WHERE cover_key IS NOT NULL");
        await sweep_orphan_covers(cover_dir, rows.map((row) => row.cover_key));
      }
      await run_once(pool, now);
    } catch (error) {
      logger.error(`worker loop failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  logger.log("worker stopped");
}

export { heartbeat, run_worker };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: new URL("../../.env", import.meta.url), quiet: true });
  const pool = create_utc_pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, connection_limit: 4 });
  await assert_schema_version(pool, "017_live_signals");
  await run_worker({ pool });
  await pool.end();
}
