// Dev helper: loads the baseline schema into the disposable test DB and runs
// the migrations, printing the failing step. Usage (not collected by node --test):
//   TEST_ENV_FILE=/path/to/test.env node scripts/run_migrations_dev.mjs [--no-baseline]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { connect_test_db, reset_tables, test_db_config } from "../test/db_guard.js";
import { load_migrations, run_migrations } from "../src/db/migrate.js";

const { config, skip } = test_db_config();
if (skip) { console.log(skip); process.exit(1); }
const admin = await connect_test_db(config);
await reset_tables(admin, config.database);
if (!process.argv.includes("--no-baseline")) {
  await admin.query(await readFile(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8"));
}
const pool = mysql.createPool({ ...config, connectionLimit: 3, dateStrings: true, timezone: "Z" });
try {
  const migrations = await load_migrations(fileURLToPath(new URL("../db/migrations", import.meta.url)));
  console.log(await run_migrations({ pool, database: config.database, migrations }));
} catch (error) {
  console.log("FAILED:", error.message, error.sql?.slice(0, 200));
}
await pool.end();
await admin.end();
