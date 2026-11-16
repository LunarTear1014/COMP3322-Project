import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { load_migrations, run_migrations } from "../src/db/migrate.js";
import { connect_test_db, reset_tables, test_db_config } from "./db_guard.js";

const root = (path) => fileURLToPath(new URL(path, import.meta.url));

// Builds the beta baseline in a disposable database, optionally runs the
// migrations, and returns handles. The caller closes it with `close()`.
async function prepare_database({ migrate = true, database } = {}) {
  const { config, skip } = test_db_config();
  if (skip) throw new Error(skip);
  const settings = { ...config, ...(database ? { database } : {}) };
  const admin = await connect_test_db(settings);
  await reset_tables(admin, settings.database);
  await admin.query(await readFile(root("../db/schema.sql"), "utf8"));
  const pool = mysql.createPool({ ...settings, connectionLimit: 8, dateStrings: true, timezone: "Z" });
  const migrations = await load_migrations(root("../db/migrations"));
  const quiet = { log() {} };
  const result = migrate
    ? await run_migrations({ pool, database: settings.database, migrations, logger: quiet })
    : null;
  return {
    admin, pool, config: settings, migrations, result,
    migrate: () => run_migrations({ pool, database: settings.database, migrations, logger: quiet }),
    async close() { await pool.end(); await admin.end(); },
  };
}

export { prepare_database, test_db_config };
