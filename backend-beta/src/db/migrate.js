import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Checksummed, ordered, additive migration runner (database.md section 4).
//
// - A MySQL advisory lock for this database serializes runners.
// - Each applied migration is recorded with the SHA-256 of its file. A changed
//   file for an already-applied version aborts the run.
// - DDL commits implicitly, so a crash can leave a half-applied migration with
//   no recorded version. Migrations therefore use the idempotent helpers on
//   `ctx` (add_column, add_index, ...), which inspect information_schema and
//   skip work that already exists, so a rerun resumes safely.
// - Nothing here uses FOREIGN_KEY_CHECKS=0.

const LOCK_TIMEOUT_SECONDS = 10;
const VERSION_PATTERN = /^(\d{3})_[a-z0-9_]+\.js$/;

class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

function checksum(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function load_migrations(directory) {
  const names = (await readdir(directory)).filter((name) => VERSION_PATTERN.test(name)).sort();
  const migrations = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const source = await readFile(file, "utf8");
    const module = await import(pathToFileURL(file).href);
    if (typeof module.up !== "function") {
      throw new MigrationError("INVALID_MIGRATION", `${name} must export an up(ctx) function.`);
    }
    migrations.push({ version: name.replace(/\.js$/, ""), checksum: checksum(source), up: module.up });
  }
  assert_unique_versions(migrations);
  return migrations;
}

function assert_unique_versions(migrations) {
  const seen = new Set();
  for (const { version } of migrations) {
    const number = version.slice(0, 3);
    if (seen.has(number)) {
      throw new MigrationError("DUPLICATE_VERSION", `Two migrations share the number ${number}.`);
    }
    seen.add(number);
  }
}

// Helpers that make DDL steps safe to repeat.
function create_context(connection, database) {
  const query = async (sql, params = []) => (await connection.query(sql, params))[0];
  const exists = async (sql, params) => (await query(sql, params)).length > 0;
  return {
    database,
    query,
    table_exists: (table) => exists(
      "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
      [database, table]),
    column_exists: (table, column) => exists(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [database, table, column]),
    index_exists: (table, index) => exists(
      "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?",
      [database, table, index]),
    constraint_exists: (table, name) => exists(
      "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
      [database, table, name]),
    async add_column(table, column, definition) {
      if (await this.column_exists(table, column)) return false;
      await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      return true;
    },
    async add_index(table, index, columns, { unique = false } = {}) {
      if (await this.index_exists(table, index)) return false;
      await query(`CREATE ${unique ? "UNIQUE " : ""}INDEX \`${index}\` ON \`${table}\` (${columns})`);
      return true;
    },
    async create_table(table, ddl) {
      if (await this.table_exists(table)) return false;
      await query(ddl);
      return true;
    },
  };
}

async function run_migrations({ pool, database, migrations, logger = console, now = () => new Date() }) {
  assert_unique_versions(migrations);
  const connection = await pool.getConnection();
  const lock_name = `clubspace_migrate:${database}`;
  let locked = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [lock_name, LOCK_TIMEOUT_SECONDS]);
    if (Number(lock.acquired) !== 1) {
      throw new MigrationError("LOCK_CONTENTION", "Another migration run holds the lock.");
    }
    locked = true;

    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version VARCHAR(80) NOT NULL,
         checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
         applied_at DATETIME(6) NOT NULL,
         PRIMARY KEY (version)
       ) ENGINE=InnoDB`);
    const [rows] = await connection.query("SELECT version, checksum FROM schema_migrations ORDER BY version");
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));

    const known = new Set(migrations.map((migration) => migration.version));
    for (const [version, recorded] of applied) {
      if (!known.has(version)) {
        throw new MigrationError("UNKNOWN_APPLIED", `Database has ${version}, which this build does not ship.`);
      }
      const current = migrations.find((migration) => migration.version === version);
      if (current.checksum !== recorded) {
        throw new MigrationError("CHECKSUM_MISMATCH", `${version} changed after it was applied.`);
      }
    }

    const ran = [];
    for (const migration of [...migrations].sort((a, b) => a.version.localeCompare(b.version))) {
      if (applied.has(migration.version)) continue;
      logger.log(`migrate: applying ${migration.version}`);
      await migration.up(create_context(connection, database));
      await connection.query(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.checksum, now().toISOString().replace("T", " ").replace("Z", "000")]);
      ran.push(migration.version);
    }
    return { applied: ran, schema_version: [...applied.keys(), ...ran].sort().at(-1) ?? null };
  } finally {
    if (locked) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [lock_name]);
      } catch {
        // The lock is released when the connection closes in any case.
      }
    }
    connection.release();
  }
}

// Startup gate: the API and worker refuse to run on an older schema.
async function assert_schema_version(pool, required_version) {
  const [rows] = await pool.query("SELECT MAX(version) AS version FROM schema_migrations");
  const current = rows[0]?.version ?? null;
  if (current === null || current < required_version) {
    throw new MigrationError("SCHEMA_OUTDATED",
      `Schema is at ${current ?? "none"}; ${required_version} is required. Run the migrations.`);
  }
  return current;
}

export {
  MigrationError,
  assert_schema_version,
  checksum,
  create_context,
  load_migrations,
  run_migrations,
};
