// Operator command: apply pending migrations.
//   node src/ops/migrate.js
// Uses MIGRATION_DB_USER / MIGRATION_DB_PASSWORD when set (a DDL-capable
// account), otherwise DB_USER / DB_PASSWORD. Never run this against a
// database you have not backed up; it is additive but not reversible.
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import { load_migrations, run_migrations } from "../db/migrate.js";

dotenv.config({ path: new URL("../../../.env", import.meta.url), quiet: true });
dotenv.config({ path: new URL("../../.env", import.meta.url), quiet: true });

const database = process.env.DB_NAME;
if (!database || !process.env.DB_HOST) {
  console.error("Set DB_HOST and DB_NAME (and credentials) before migrating.");
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database,
  user: process.env.MIGRATION_DB_USER || process.env.DB_USER,
  password: process.env.MIGRATION_DB_PASSWORD || process.env.DB_PASSWORD,
  connectionLimit: 2,
  dateStrings: true,
  timezone: "Z",
});

try {
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url));
  const migrations = await load_migrations(directory);
  const result = await run_migrations({ pool, database, migrations });
  console.log(result.applied.length
    ? `Applied: ${result.applied.join(", ")}`
    : "Schema is up to date.");
  console.log(`Schema version: ${result.schema_version}`);
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
