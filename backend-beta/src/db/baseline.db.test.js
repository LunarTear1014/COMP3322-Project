import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { prepare_database, test_db_config } from "../../test/db_helper.js";

// Fresh install and upgrade of a populated beta database must end with the same
// schema and the same migration versions (task 2.6). The second database is
// `<TEST_DB_NAME>_upgrade`; the test account may create `clubspace_test_%`.
const { config, skip } = test_db_config();
const handles = [];
after(async () => { for (const handle of handles) await handle.close(); });

async function create_extra_database(admin, name) {
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

async function structure(admin, database) {
  const [columns] = await admin.query(
    `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_DEFAULT d, EXTRA e, GENERATION_EXPRESSION g, COLLATION_NAME co
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [database]);
  const [indexes] = await admin.query(
    `SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE u, SEQ_IN_INDEX s, COLUMN_NAME c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [database]);
  const [constraints] = await admin.query(
    `SELECT TABLE_NAME t, CONSTRAINT_NAME n, CONSTRAINT_TYPE ty FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, CONSTRAINT_NAME`, [database]);
  const [foreign] = await admin.query(
    `SELECT TABLE_NAME t, CONSTRAINT_NAME n, REFERENCED_TABLE_NAME r, DELETE_RULE d FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? ORDER BY TABLE_NAME, CONSTRAINT_NAME`, [database]);
  return JSON.stringify({ columns, indexes, constraints, foreign });
}

describe("fresh install versus upgrade", { skip }, () => {
  test("the baseline has no index on a nonexistent users.role, and both paths end with identical schema and versions", async () => {
    const schema = await readFile(fileURLToPath(new URL("../../db/schema.sql", import.meta.url)), "utf8");
    assert.ok(!/idx_users_role|ON `users` \(`role`\)/.test(schema), "fresh schema must not index users.role");

    const fresh = await prepare_database();
    handles.push(fresh);
    const upgrade_name = `${config.database}_upgrade`;
    await create_extra_database(fresh.admin, upgrade_name);
    process.env.LEGACY_DATETIME_TIMEZONE = "Asia/Taipei";
    const upgraded = await prepare_database({ migrate: false, database: upgrade_name });
    handles.push(upgraded);
    await upgraded.admin.query(`
      INSERT INTO users (id, email, password_hash, name, student_id) VALUES (1, 'a@t.test', 'x', 'A', 's1');
      INSERT INTO clubs (id, name) VALUES (1, 'Club');
      INSERT INTO venues (id, name, location, capacity) VALUES (1, 'Hall', 'L1', 50);
      INSERT INTO bookings (id, venue_id, club_id, start_time, end_time, status) VALUES (1, 1, 1, '2026-11-20 13:00:00', '2026-11-20 15:00:00', 'confirmed');
      INSERT INTO events (id, booking_id, club_id, title, start_time, end_time, capacity) VALUES (1, 1, 1, 'E', '2026-11-20 13:00:00', '2026-11-20 15:00:00', 10);`);
    await upgraded.migrate();
    delete process.env.LEGACY_DATETIME_TIMEZONE;

    assert.equal(await structure(upgraded.admin, upgrade_name), await structure(fresh.admin, config.database));
    const versions = async (db) => (await db.admin.query("SELECT version, checksum FROM schema_migrations ORDER BY version"))[0].map((r) => `${r.version}:${r.checksum}`);
    assert.deepEqual(await versions(upgraded), await versions(fresh));
    assert.equal((await versions(fresh)).length, fresh.migrations.length);
    const [[kept]] = await upgraded.admin.query("SELECT COUNT(*) AS n FROM events WHERE id = 1 AND title = 'E'");
    assert.equal(Number(kept.n), 1, "IDs and rows are preserved");
    await fresh.admin.query(`DROP DATABASE IF EXISTS \`${upgrade_name}\``);
  });
});
