import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MigrationError, assert_schema_version, checksum, run_migrations } from "./migrate.js";

// Minimal in-memory stand-in for the parts of MySQL the runner touches.
function fake_db({ lock_free = true, recorded = [] } = {}) {
  const state = {
    rows: recorded.map((row) => ({ ...row })),
    lock_held: !lock_free,
    released: false,
    columns: new Set(),
    log: [],
  };
  const connection = {
    async query(sql, params = []) {
      state.log.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql.includes("GET_LOCK")) return [[{ acquired: state.lock_held ? 0 : 1 }]];
      if (sql.includes("RELEASE_LOCK")) { state.released = true; return [[{}]]; }
      if (sql.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return [[]];
      if (sql.startsWith("SELECT version, checksum")) return [state.rows];
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        state.rows.push({ version: params[0], checksum: params[1] });
        return [[]];
      }
      if (sql.includes("information_schema.COLUMNS")) {
        return [state.columns.has(`${params[1]}.${params[2]}`) ? [{ 1: 1 }] : []];
      }
      if (sql.startsWith("ALTER TABLE")) {
        const [, table, column] = /ALTER TABLE `(\w+)` ADD COLUMN `(\w+)`/.exec(sql);
        state.columns.add(`${table}.${column}`);
        return [[]];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    release() { state.connection_released = true; },
  };
  return { state, pool: { async getConnection() { return connection; } } };
}

const quiet = { log() {} };
const make = (version, up, source = version) => ({ version, checksum: checksum(source), up });

describe("migration runner", () => {
  test("applies pending migrations in order and records checksums", async () => {
    const { pool, state } = fake_db();
    const order = [];
    const result = await run_migrations({
      pool, database: "t", logger: quiet,
      migrations: [make("002_b", async () => order.push("b")), make("001_a", async () => order.push("a"))],
    });
    assert.deepEqual(order, ["a", "b"]);
    assert.deepEqual(result.applied, ["001_a", "002_b"]);
    assert.equal(result.schema_version, "002_b");
    assert.deepEqual(state.rows.map((row) => row.version), ["001_a", "002_b"]);
    assert.equal(state.rows[0].checksum, checksum("001_a"));
    assert.ok(state.released && state.connection_released);
  });

  test("a rerun applies nothing", async () => {
    const { pool, state } = fake_db();
    const migrations = [make("001_a", async () => {})];
    await run_migrations({ pool, database: "t", migrations, logger: quiet });
    let again = 0;
    const result = await run_migrations({
      pool, database: "t", logger: quiet, migrations: [make("001_a", async () => { again += 1; })],
    });
    assert.equal(again, 0);
    assert.deepEqual(result.applied, []);
    assert.equal(state.rows.length, 1);
  });

  test("a changed file for an applied version aborts", async () => {
    const { pool } = fake_db({ recorded: [{ version: "001_a", checksum: checksum("old") }] });
    await assert.rejects(() => run_migrations({
      pool, database: "t", logger: quiet, migrations: [make("001_a", async () => {}, "new")],
    }), (error) => error instanceof MigrationError && error.code === "CHECKSUM_MISMATCH");
  });

  test("a database ahead of the build aborts", async () => {
    const { pool } = fake_db({ recorded: [{ version: "009_future", checksum: "x" }] });
    await assert.rejects(() => run_migrations({ pool, database: "t", logger: quiet, migrations: [] }),
      (error) => error.code === "UNKNOWN_APPLIED");
  });

  test("lock contention fails without running anything and keeps the lock untouched", async () => {
    const { pool, state } = fake_db({ lock_free: false });
    let ran = false;
    await assert.rejects(() => run_migrations({
      pool, database: "t", logger: quiet, migrations: [make("001_a", async () => { ran = true; })],
    }), (error) => error.code === "LOCK_CONTENTION");
    assert.equal(ran, false);
    assert.equal(state.released, false);
    assert.ok(state.connection_released);
  });

  test("an interrupted migration records nothing and resumes idempotently", async () => {
    const { pool, state } = fake_db();
    let crash = true;
    const up = async (ctx) => {
      await ctx.add_column("events", "cover_key", "VARCHAR(64) NULL");
      if (crash) throw new Error("simulated crash between DDL steps");
      await ctx.add_column("events", "cover_alt", "VARCHAR(200) NULL");
    };
    const migrations = [make("001_covers", up)];
    await assert.rejects(() => run_migrations({ pool, database: "t", migrations, logger: quiet }), /simulated crash/);
    assert.equal(state.rows.length, 0, "version is recorded only after the whole step succeeds");
    assert.ok(state.columns.has("events.cover_key"), "first DDL step stuck");
    assert.ok(state.released, "lock released after failure");

    crash = false;
    const alters_before = state.log.filter((line) => line.startsWith("ALTER TABLE")).length;
    const result = await run_migrations({ pool, database: "t", migrations, logger: quiet });
    assert.deepEqual(result.applied, ["001_covers"]);
    assert.equal(state.log.filter((line) => line.startsWith("ALTER TABLE")).length, alters_before + 1,
      "the already-applied column is skipped on rerun");
    assert.ok(state.columns.has("events.cover_alt"));
  });

  test("duplicate migration numbers are rejected", async () => {
    const { pool } = fake_db();
    await assert.rejects(() => run_migrations({
      pool, database: "t", logger: quiet,
      migrations: [make("001_a", async () => {}), make("001_b", async () => {})],
    }), (error) => error.code === "DUPLICATE_VERSION");
  });
});

describe("schema version gate", () => {
  test("refuses an older or empty schema", async () => {
    const pool_with = (version) => ({ async query() { return [[{ version }]]; } });
    await assert.rejects(() => assert_schema_version(pool_with(null), "010_x"), (e) => e.code === "SCHEMA_OUTDATED");
    await assert.rejects(() => assert_schema_version(pool_with("005_x"), "010_x"), (e) => e.code === "SCHEMA_OUTDATED");
    assert.equal(await assert_schema_version(pool_with("010_x"), "010_x"), "010_x");
  });
});
