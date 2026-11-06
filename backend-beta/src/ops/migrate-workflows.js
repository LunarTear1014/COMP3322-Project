import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pool from "../config/db.js";

// MySQL DDL commits implicitly. A persisted 'started' marker deliberately
// blocks automatic replay if a process dies between DDL statements.
const migrations = [
  ["20261106_cancelled_participations.sql", [["column_type", "participations", "status", "cancelled"]]],
  ["20261106_notification_jobs.sql", [["table", "notification_jobs"], ["column", "notifications", "dedup_key"]]],
  ["20261106_participation_history.sql", [["table", "participation_history"], ["table", "workflow_metadata"]]],
  ["20261106_booking_approval.sql", [["column", "users", "platform_role"], ["column", "bookings", "version"], ["column", "events", "version"], ["table", "audit_logs"]]],
  ["20261106_sessions.sql", [["table", "sessions"]]],
  ["20261106_worker_heartbeats.sql", [["table", "worker_heartbeats"]]],
  ["20261106_notification_contract.sql", [["column", "notifications", "booking_id"], ["column", "notifications", "type"]]],
  ["20261106_participation_times.sql", [["column", "participations", "last_registered_at"], ["column", "participations", "queued_at"], ["column", "participations", "confirmed_at"]]],
  ["20261106_event_join_requests.sql", [["table", "event_join_requests"]]],
];

if (process.argv.length !== 3 || process.argv[2] !== "--legacy-hkt") {
  console.error("Stop all old writers, verify a backup, confirm legacy event datetimes are Hong Kong local time, then run with --legacy-hkt.");
  process.exit(2);
}

async function preflight(connection, checks) {
  for (const [kind, table, column, marker] of checks) {
    if (kind === "table") {
      const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", [table]);
      if (row.n) throw new Error(`Unexpected existing table ${table}; inspect the schema before proceeding.`);
    } else {
      const [[row]] = await connection.query("SELECT COLUMN_TYPE AS type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?", [table, column]);
      if ((kind === "column" && row) || (kind === "column_type" && (!row || row.type.includes(marker)))) {
        throw new Error(`Unexpected state for ${table}.${column}; inspect the schema before proceeding.`);
      }
    }
  }
}

// Check legacy data before the first DDL step. Report counts, never user data.
async function verifyLegacyIntegrity(connection) {
  const checks = [
    ["orphaned or mismatched event bookings", `SELECT COUNT(*) AS n FROM events e LEFT JOIN bookings b ON b.id=e.booking_id
      WHERE b.id IS NULL OR e.club_id<>b.club_id OR e.start_time<>b.start_time OR e.end_time<>b.end_time`],
    ["orphaned booking parents", `SELECT COUNT(*) AS n FROM bookings b LEFT JOIN clubs c ON c.id=b.club_id
      LEFT JOIN venues v ON v.id=b.venue_id WHERE c.id IS NULL OR v.id IS NULL`],
    ["orphaned participation records", `SELECT COUNT(*) AS n FROM participations p LEFT JOIN users u ON u.id=p.user_id
      LEFT JOIN events e ON e.id=p.event_id WHERE u.id IS NULL OR e.id IS NULL`],
    ["orphaned memberships", `SELECT COUNT(*) AS n FROM memberships m LEFT JOIN users u ON u.id=m.user_id
      LEFT JOIN clubs c ON c.id=m.club_id WHERE u.id IS NULL OR c.id IS NULL`],
    ["overlapping confirmed bookings", `SELECT COUNT(*) AS n FROM bookings a JOIN bookings b ON a.venue_id=b.venue_id
      AND a.id<b.id AND a.status='confirmed' AND b.status='confirmed' AND a.start_time<b.end_time AND a.end_time>b.start_time`],
    ["invalid event or venue capacities", `SELECT COUNT(*) AS n FROM events e JOIN bookings b ON b.id=e.booking_id
      JOIN venues v ON v.id=b.venue_id WHERE e.capacity<1 OR e.capacity>500 OR e.capacity>v.capacity OR v.capacity<1 OR v.capacity>500`],
    ["invalid venue capacities", "SELECT COUNT(*) AS n FROM venues WHERE capacity<1 OR capacity>500"],
    ["invalid booking or event intervals", `SELECT (SELECT COUNT(*) FROM bookings WHERE end_time<=start_time) +
      (SELECT COUNT(*) FROM events WHERE end_time<=start_time) AS n`],
    ["oversized waitlists", `SELECT COUNT(*) AS n FROM (SELECT event_id FROM participations WHERE status='waitlisted'
      GROUP BY event_id HAVING COUNT(*)>500) q`],
    ["conflicting normalized email addresses", `SELECT COUNT(*) AS n FROM (SELECT LOWER(TRIM(email)) AS value FROM users
      GROUP BY LOWER(TRIM(email)) HAVING COUNT(*)>1) q`],
    ["conflicting normalized student IDs", `SELECT COUNT(*) AS n FROM (SELECT LOWER(TRIM(student_id)) AS value FROM users
      GROUP BY LOWER(TRIM(student_id)) HAVING COUNT(*)>1) q`],
    ["published events without confirmed bookings", `SELECT COUNT(*) AS n FROM events e JOIN bookings b ON b.id=e.booking_id
      WHERE e.status='published' AND b.status<>'confirmed'`],
    ["cancelled events with active bookings", `SELECT COUNT(*) AS n FROM events e JOIN bookings b ON b.id=e.booking_id
      WHERE e.status='cancelled' AND b.status='confirmed'`],
  ];
  const problems = [];
  for (const [label, sql] of checks) {
    const [[row]] = await connection.query(sql);
    if (Number(row.n)) problems.push(`${label}: ${row.n}`);
  }
  if (problems.length) throw new Error(`Legacy integrity preflight requires repair (${problems.join('; ')}).`);
  console.log('Legacy integrity preflight: passed');
}

const connection = await pool.getConnection();
const lockName = `clubspace-migrate-${createHash("sha256").update(process.env.DB_NAME).digest("hex").slice(0, 32)}`;
let locked = false;
try {
  const [[version]] = await connection.query("SELECT VERSION() AS version");
  if (!/^8\.4\./.test(version.version)) throw new Error("Migration requires MySQL 8.4.");
  const [[lock]] = await connection.query("SELECT GET_LOCK(?,10) AS acquired", [lockName]);
  if (lock.acquired !== 1) throw new Error("Could not acquire the database migration lock.");
  locked = true;
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state ENUM('started','applied') NOT NULL, started_at DATETIME(6) NOT NULL, applied_at DATETIME(6) NULL
  ) ENGINE=InnoDB`);
  const [[applied]] = await connection.query("SELECT COUNT(*) AS n FROM schema_migrations WHERE state='applied'");
  if (Number(applied.n) === 0) await verifyLegacyIntegrity(connection);
  for (const [name, checks] of migrations) {
    const sql = await readFile(new URL(`../../db/migrations/${name}`, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const [[prior]] = await connection.query("SELECT checksum,state FROM schema_migrations WHERE version=?", [name]);
    if (prior) {
      if (prior.checksum !== checksum) throw new Error(`Checksum mismatch for ${name}.`);
      if (prior.state !== "applied") throw new Error(`Migration ${name} was interrupted; inspect and repair it before proceeding.`);
      console.log(`${name}: already applied`);
      continue;
    }
    await preflight(connection, checks);
    await connection.query("INSERT INTO schema_migrations (version,checksum,state,started_at) VALUES (?,?,'started',UTC_TIMESTAMP(6))", [name, checksum]);
    const statements = sql.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n").split(";").map(part => part.trim()).filter(Boolean);
    for (const statement of statements) await connection.query(statement);
    await connection.query("UPDATE schema_migrations SET state='applied',applied_at=UTC_TIMESTAMP(6) WHERE version=?", [name]);
    console.log(`${name}: applied`);
  }
} catch (error) {
  console.error(`Migration stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
  connection.release();
  await pool.end();
}
