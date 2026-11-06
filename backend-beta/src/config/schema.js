import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const required = [
  "20261106_cancelled_participations.sql", "20261106_notification_jobs.sql",
  "20261106_participation_history.sql", "20261106_booking_approval.sql",
  "20261106_sessions.sql", "20261106_worker_heartbeats.sql",
  "20261106_notification_contract.sql",
  "20261106_participation_times.sql",
  "20261106_event_join_requests.sql",
];

export async function verifyWorkflowSchema(pool) {
  const [rows] = await pool.query("SELECT version,checksum,state FROM schema_migrations");
  const records = new Map(rows.map(row => [row.version, row]));
  if (rows.some(row => row.state !== "applied" || !required.includes(row.version))) throw new Error("An unfinished or unknown migration requires operator review.");
  for (const name of required) {
    const content = await readFile(new URL(`../../db/migrations/${name}`, import.meta.url));
    const checksum = createHash("sha256").update(content).digest("hex");
    if (records.get(name)?.checksum !== checksum) throw new Error(`Missing or mismatched migration: ${name}`);
  }
}
