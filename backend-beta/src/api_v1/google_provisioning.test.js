import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provision_google_user, GoogleProvisionRaceError, GoogleEmailUnverifiedError, GoogleSubAlreadyLinkedError } from "./google_provisioning.js";
import { NO_PASSWORD_SENTINEL } from "./identity.js";

// Unit tests for the provisioning decision table over a fake transaction
// connection: sub-match, verified-email link, creation, unverified-email
// rejection and the duplicate races. The DB integration tests
// (google.db.test.js) exercise the real SQL.

// The smallest fake that satisfies with_transaction: getConnection -> query /
// beginTransaction / commit / release, recording data statements. `dup` lists
// the write slots that lose a unique-index race.
function fake_pool({ rows_by_table, fail_on }) {
  const statements = [];
  const dup = new Set(fail_on?.dup ?? []);
  return {
    statements,
    async getConnection() {
      return {
        async query(sql, params = []) {
          // Only data statements are interesting for the assertions.
          const writes = /^(INSERT|UPDATE)/.test(sql);
          if (/(?:FROM|UPDATE|INTO) (\w+)/.test(sql)) statements.push({ sql, params });
          const table = /(?:FROM|UPDATE|INTO) (\w+)/.exec(sql)?.[1];
          // A duplicate slot can only be lost on a write (the loser's INSERT
          // or UPDATE hits the unique index), never on a SELECT.
          if (writes && dup.has(`${table}:${params[0]}`)) {
            const error = new Error("duplicate");
            error.code = "ER_DUP_ENTRY";
            throw error;
          }
          const rows = rows_by_table[table]?.(params, sql) ?? [];
          if (writes) return [{ insertId: 1 }, []];
          return [rows, []];
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };
}

describe("google provisioning decisions (unit)", () => {
  test("a google_sub match signs the user in and never touches the row", async () => {
    const pool = fake_pool({ rows_by_table: { users: () => [{ id: 7 }] } });
    const user_id = await provision_google_user(pool, { sub: "sub-1", email: "a@x.test", email_verified: true, name: "A" });
    assert.equal(user_id, 7);
    assert.deepEqual(pool.statements.map((s) => s.sql.match(/(SELECT|UPDATE|INSERT)/)[0]), ["SELECT"]);
  });

  test("google_sub wins over email even when a different row owns the address", async () => {
    // The email row exists too — the Subject match must still win and no
    // UPDATE may run (an email change on Google's side keeps the row stable).
    const pool = fake_pool({ rows_by_table: { users: (params) => [{ id: 9 }] } });
    const user_id = await provision_google_user(pool, { sub: "sub-2", email: "taken@x.test", email_verified: true, name: "B" });
    assert.equal(user_id, 9);
    assert.equal(pool.statements.length, 1, "one SELECT, no writes");
  });

  test("a verified email links the existing password row by setting google_sub", async () => {
    const pool = fake_pool({ rows_by_table: { users: ([value]) => (value === "sub-3" ? [] : [{ id: 5 }, { google_sub: null }]) } });
    const user_id = await provision_google_user(pool, { sub: "sub-3", email: "linked@x.test", email_verified: true, name: "C" });
    assert.equal(user_id, 5);
    const update = pool.statements.find((s) => s.sql.startsWith("UPDATE"));
    assert.match(update.sql, /UPDATE users SET google_sub/);
    assert.deepEqual(update.params, ["sub-3", 5]);
  });

  test("the email lookup normalizes like login: LOWER(TRIM(email))", async () => {
    const pool = fake_pool({ rows_by_table: { users: ([value]) => (value === "sub-3n" ? [] : [{ id: 6 }, { google_sub: null }]) } });
    await provision_google_user(pool, { sub: "sub-3n", email: "Padded@X.test", email_verified: true, name: "N" });
    const select = pool.statements.find((s) => s.sql.startsWith("SELECT id FROM users WHERE LOWER(TRIM"));
    assert.ok(select, "the normalized lookup ran");
    assert.deepEqual(select.params, ["Padded@X.test"]);
  });

  test("an unverified email is rejected before any row is read for email or written", async () => {
    const pool = fake_pool({ rows_by_table: {} });
    await assert.rejects(
      provision_google_user(pool, { sub: "sub-4", email: "no@x.test", email_verified: false, name: "D" }),
      GoogleEmailUnverifiedError);
    assert.deepEqual(pool.statements.map((s) => s.sql.match(/(SELECT|UPDATE|INSERT)/)[0]), ["SELECT"], "only the sub lookup ran");
  });

  test("no match creates a student with the sentinel password and null student_id", async () => {
    const pool = fake_pool({ rows_by_table: { users: () => [] } });
    const user_id = await provision_google_user(pool, { sub: "sub-5", email: "new@x.test", email_verified: true, name: "E" });
    assert.equal(user_id, 1);
    const insert = pool.statements.find((s) => s.sql.startsWith("INSERT"));
    assert.match(insert.sql, /INSERT INTO users/);
    assert.deepEqual(insert.params, ["new@x.test", NO_PASSWORD_SENTINEL, "E", "sub-5"]);
    assert.match(insert.sql, /NULL/, "student_id stays null");
    assert.match(insert.sql, /'student'/);
  });

  test("a duplicate google_sub race while linking raises GoogleProvisionRaceError", async () => {
    const pool = fake_pool({ rows_by_table: { users: ([value]) => (value === "sub-6" ? [] : [{ id: 3 }, { google_sub: null }]) }, fail_on: { dup: ["users:sub-6"] } });
    await assert.rejects(
      provision_google_user(pool, { sub: "sub-6", email: "linked@x.test", email_verified: true, name: "F" }),
      GoogleProvisionRaceError);
  });

  test("a duplicate email race while creating raises GoogleProvisionRaceError", async () => {
    const pool = fake_pool({ rows_by_table: { users: () => [] }, fail_on: { dup: ["users:new@x.test"] } });
    await assert.rejects(
      provision_google_user(pool, { sub: "sub-7", email: "new@x.test", email_verified: true, name: "G" }),
      GoogleProvisionRaceError);
  });

  test("linking a row that already belongs to a different Google account is rejected", async () => {
    // The owned lookup passes the row id: dispatch on the sql shape, not the param.
    const pool = fake_pool({ rows_by_table: { users: (params, sql) => (/google_sub FROM/.test(sql) ? [{ google_sub: "sub-other" }] : /google_sub = \?/.test(sql) ? [] : [{ id: 4 }]) } });
    await assert.rejects(
      provision_google_user(pool, { sub: "sub-8", email: "claimed@x.test", email_verified: true, name: "H" }),
      GoogleSubAlreadyLinkedError);
    assert.equal(pool.statements.some((s) => s.sql.startsWith("UPDATE")), false, "no silent re-pointing");
  });

  test("re-linking a row that already carries the same google_sub is idempotent", async () => {
    const pool = fake_pool({ rows_by_table: { users: (params, sql) => (/google_sub FROM/.test(sql) ? [{ google_sub: "sub-9" }] : /google_sub = \?/.test(sql) ? [] : [{ id: 8 }]) } });
    const user_id = await provision_google_user(pool, { sub: "sub-9", email: "again@x.test", email_verified: true, name: "I" });
    assert.equal(user_id, 8);
    assert.equal(pool.statements.some((s) => s.sql.startsWith("UPDATE")), false, "no write needed");
  });
});
