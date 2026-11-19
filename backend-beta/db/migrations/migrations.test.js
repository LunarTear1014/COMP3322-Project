import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load_migrations } from "../../src/db/migrate.js";

// Shape checks that need no database: every shipped migration loads, is
// ordered, runs against a recording context, and only issues additive SQL.
const directory = fileURLToPath(new URL(".", import.meta.url));

function recording_context() {
  const statements = [];
  const record = async (sql) => { statements.push(sql.replace(/\s+/g, " ").trim()); return []; };
  return {
    statements,
    database: "recorded",
    query: async (sql) => { statements.push(sql.replace(/\s+/g, " ").trim()); return /\) AS n$|ENGINE AS engine/.test(sql.trim()) ? [{ n: 0, engine: "InnoDB" }] : []; },
    constraint_exists: async () => false,
    add_column: async (table, column, definition) => record(`ADD COLUMN ${table}.${column} ${definition}`),
    add_index: async (table, index, columns) => record(`ADD INDEX ${table}.${index} (${columns})`),
    create_table: async (table, ddl) => record(ddl),
  };
}

test("shipped migrations load in order with unique numbers", async () => {
  const migrations = await load_migrations(directory);
  assert.deepEqual(migrations.map((migration) => migration.version), [
    "001_preflight", "002_workflow_columns", "003_support_tables", "004_backfill_utc", "005_constraints_indexes", "006_cutover_marker", "010_club_president", "011_signoff_states",
    "012_tags", "013_attendance_views", "014_notifications_live", "015_events_cover", "016_join_requests", "017_live_signals",
    "018_google_identity", "019_club_icons", "020_admin_no_club_roles", "021_club_photos", "022_member_removal_requests",
  ]);
  for (const migration of migrations) assert.match(migration.checksum, /^[0-9a-f]{64}$/);
});

test("migrations are additive and never disable foreign key checks", async () => {
  for (const migration of await load_migrations(directory)) {
    const context = recording_context();
    // Migration 010 inspects data first; an empty result means no duplicates.
    await migration.up(context);
    assert.ok(context.statements.length > 0, `${migration.version} issued no statements`);
    for (const sql of context.statements) {
      assert.doesNotMatch(sql, /FOREIGN_KEY_CHECKS/i, migration.version);
      assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i, migration.version);
      assert.doesNotMatch(sql, /\bTRUNCATE\b|\bDELETE\s+FROM\b/i, migration.version);
      assert.doesNotMatch(sql, /\bDROP\s+(INDEX|CONSTRAINT)\b/i, migration.version);
    }
  }
});

test("010 refuses clubs that already have two presidents", async () => {
  const [migration] = (await load_migrations(directory)).filter((m) => m.version === "010_club_president");
  const context = { query: async () => [{ club_id: 7, presidents: 2 }] };
  await assert.rejects(() => migration.up(context), (error) => error.code === "PREFLIGHT_FAILED" && /7/.test(error.message));
});

test("020 refuses venue admins that still hold club roles", async () => {
  const [migration] = (await load_migrations(directory)).filter((m) => m.version === "020_admin_no_club_roles");
  const context = { query: async (sql) => (/FROM memberships/.test(sql) ? [{ user_id: 9, email: "admin@example.test", club_id: 3, role: "committee" }] : []) };
  await assert.rejects(() => migration.up(context), (error) => error.code === "PREFLIGHT_FAILED" && /admin@example\.test/.test(error.message) && /club 3/.test(error.message));
  const pending = { query: async (sql) => (/club_join_requests/.test(sql) ? [{ user_id: 9, email: "a@example.test", club_id: 4 }] : []) };
  await assert.rejects(() => migration.up(pending), (error) => error.code === "PREFLIGHT_FAILED" && /club 4/.test(error.message));
});
