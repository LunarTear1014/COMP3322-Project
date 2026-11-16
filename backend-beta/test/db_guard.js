import dotenv from "dotenv";
import mysql from "mysql2/promise";

// TEST_ENV_FILE=/path/to/test.env loads the TEST_DB_* settings without printing them.
if (process.env.TEST_ENV_FILE) dotenv.config({ path: process.env.TEST_ENV_FILE, quiet: true });

// Destructive-test isolation. DB integration tests run only when
//   TEST_DB_NAME=<disposable database>   (must contain "test", must not be
//   DB_NAME or "clubspace")
// is set. Connection settings come from TEST_DB_HOST/PORT/USER/PASSWORD, or
// fall back to DB_HOST/PORT/USER/PASSWORD. The database must already exist; the
// tests never create or drop databases, only tables inside it.

function test_db_config(env = process.env) {
  const database = env.TEST_DB_NAME;
  if (!database) return { skip: "set TEST_DB_NAME to a disposable database to run DB tests" };
  if (!/test/i.test(database) || database === env.DB_NAME || database === "clubspace") {
    return { skip: `refusing to use ${database}: the name must contain "test" and differ from DB_NAME` };
  }
  return {
    config: {
      host: env.TEST_DB_HOST || env.DB_HOST,
      port: Number(env.TEST_DB_PORT || env.DB_PORT || 3306),
      user: env.TEST_DB_USER || env.DB_USER,
      password: env.TEST_DB_PASSWORD || env.DB_PASSWORD,
      database,
    },
  };
}

async function connect_test_db(config, options = {}) {
  return mysql.createConnection({
    ...config,
    multipleStatements: true,
    dateStrings: true,
    timezone: "Z",
    ...options,
  });
}

// Drops every table inside the (guarded) disposable database. Never drops the database.
async function reset_tables(connection, database) {
  if (!/test/i.test(database) || database === "clubspace") throw new Error(`refusing to reset ${database}`);
  const [rows] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { name } of rows) await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
}

export { connect_test_db, reset_tables, test_db_config };
