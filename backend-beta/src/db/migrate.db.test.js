import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { connect_test_db, test_db_config } from "../../test/db_guard.js";
import { load_migrations, run_migrations } from "./migrate.js";

// Runs only against a disposable database (see test/db_guard.js). NOT RUN in
// the agent session that wrote it: the configured account cannot create a test
// database (see IMPLEMENTATION-STATUS B1).
const { config, skip } = test_db_config();

describe("migrations on a disposable MySQL database", { skip }, () => {
  let admin;
  let pool;

  before(async () => {
    admin = await connect_test_db(config);
    const schema = await readFile(fileURLToPath(new URL("../../db/schema.sql", import.meta.url)), "utf8");
    await admin.query(schema); // beta baseline; drops and recreates tables in the test DB only
    pool = mysql.createPool({ ...config, connectionLimit: 3, dateStrings: true, timezone: "Z" });
  });

  after(async () => {
    await pool?.end();
    await admin?.end();
  });

  test("fresh baseline migrates, reruns as a no-op, and keeps one president per club", async () => {
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url));
    const migrations = await load_migrations(directory);
    const first = await run_migrations({ pool, database: config.database, migrations, logger: { log() {} } });
    assert.equal(first.applied.length, migrations.length);
    const second = await run_migrations({ pool, database: config.database, migrations, logger: { log() {} } });
    assert.deepEqual(second.applied, []);

    await admin.query("INSERT INTO clubs (name) VALUES ('A'), ('B')");
    await admin.query("INSERT INTO users (email, password_hash, name, student_id) VALUES ('p1@t', 'x', 'P1', 's1'), ('p2@t', 'x', 'P2', 's2')");
    await admin.query("INSERT INTO memberships (user_id, club_id, role) SELECT 1, id, 'president' FROM clubs WHERE name = 'A'");
    await assert.rejects(
      () => admin.query("INSERT INTO memberships (user_id, club_id, role) SELECT 2, id, 'president' FROM clubs WHERE name = 'A'"),
      (error) => error.code === "ER_DUP_ENTRY");
  });

  test("migration lock contention is reported, not queued forever", async () => {
    const holder = await pool.getConnection();
    await holder.query("SELECT GET_LOCK(?, 5)", [`clubspace_migrate:${config.database}`]);
    try {
      await assert.rejects(
        () => run_migrations({ pool, database: config.database, migrations: [], logger: { log() {} } }),
        (error) => error.code === "LOCK_CONTENTION");
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [`clubspace_migrate:${config.database}`]);
      holder.release();
    }
  });
});
