// Operator command: put one failed notification job back in the queue and
// record who did it in the audit log.
//   node src/ops/retry-notification-job.js JOB_ID OPERATOR_NAME
import dotenv from "dotenv";
import { create_utc_pool } from "../db/pool.js";
import { requeue_failed } from "../jobs/queue.js";

dotenv.config({ path: new URL("../../../.env", import.meta.url), quiet: true });
dotenv.config({ path: new URL("../../.env", import.meta.url), quiet: true });

const job_id = Number(process.argv[2]);
const operator = String(process.argv[3] || "").trim();
if (!Number.isSafeInteger(job_id) || job_id < 1 || !operator || operator.length > 64) {
  console.error("Usage: node src/ops/retry-notification-job.js JOB_ID OPERATOR_NAME");
  process.exit(2);
}

const pool = create_utc_pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connection_limit: 1,
});
try {
  if (await requeue_failed(pool, job_id, { now: new Date(), operator })) {
    console.log(`Notification job ${job_id} queued for retry.`);
  } else {
    console.error(`Job ${job_id} is missing or is not failed.`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
