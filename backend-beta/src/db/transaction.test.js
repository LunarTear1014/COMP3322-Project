import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ordered_locks, with_transaction } from "./transaction.js";

function fake_pool({ commit_error = null, rollback_error = null } = {}) {
  const log = [];
  const connection = {
    async query(sql) { log.push(sql); },
    async beginTransaction() { log.push("begin"); },
    async commit() {
      log.push("commit");
      if (commit_error) throw commit_error;
    },
    async rollback() {
      log.push("rollback");
      if (rollback_error) throw rollback_error;
    },
    release() { log.push("release"); },
  };
  return { log, async getConnection() { log.push("acquire"); return connection; } };
}

const deadlock = () => Object.assign(new Error("deadlock"), { errno: 1213 });
const no_wait = { sleep: async () => {}, random: () => 0.5 };

describe("with_transaction", () => {
  test("commits and releases on success under READ COMMITTED", async () => {
    const pool = fake_pool();
    assert.equal(await with_transaction(pool, async () => "ok", no_wait), "ok");
    assert.deepEqual(pool.log, [
      "acquire", "SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "begin", "commit", "release",
    ]);
  });

  test("rolls back and releases on error, preserving the original error", async () => {
    const pool = fake_pool({ rollback_error: new Error("rollback failed") });
    const original = new Error("business failure");
    await assert.rejects(() => with_transaction(pool, async () => { throw original; }, no_wait),
      (error) => error === original);
    assert.ok(pool.log.includes("rollback"));
    assert.equal(pool.log.at(-1), "release");
  });

  test("retries a deadlock twice with bounded jitter, then succeeds", async () => {
    const pool = fake_pool();
    const sleeps = [];
    let calls = 0;
    const result = await with_transaction(pool, async () => {
      calls += 1;
      if (calls < 3) throw deadlock();
      return "done";
    }, { sleep: async (ms) => sleeps.push(ms), random: () => 0 });
    assert.equal(result, "done");
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [25, 100]);
    assert.equal(pool.log.filter((line) => line === "release").length, 3);
    assert.equal(pool.log.filter((line) => line === "rollback").length, 2);
  });

  test("jitter stays inside the documented windows", async () => {
    for (const random of [0, 0.999]) {
      const sleeps = [];
      await assert.rejects(() => with_transaction(fake_pool(), async () => { throw deadlock(); },
        { sleep: async (ms) => sleeps.push(ms), random: () => random }));
      assert.ok(sleeps[0] >= 25 && sleeps[0] <= 100);
      assert.ok(sleeps[1] >= 100 && sleeps[1] <= 250);
    }
  });

  test("exhaustion returns 503 TRANSACTION_RETRY_EXHAUSTED after three attempts", async () => {
    let calls = 0;
    await assert.rejects(() => with_transaction(fake_pool(), async () => { calls += 1; throw deadlock(); }, no_wait),
      (error) => error.code === "TRANSACTION_RETRY_EXHAUSTED" && error.status === 503);
    assert.equal(calls, 3);
  });

  test("a failed commit is flagged uncertain and never retried", async () => {
    const lost = Object.assign(new Error("connection lost"), { code: "PROTOCOL_CONNECTION_LOST" });
    const pool = fake_pool({ commit_error: lost });
    let calls = 0;
    await assert.rejects(() => with_transaction(pool, async () => { calls += 1; }, no_wait),
      (error) => error === lost && error.uncertain_commit === true);
    assert.equal(calls, 1);
    assert.ok(!pool.log.includes("rollback"));
    assert.equal(pool.log.at(-1), "release");
  });

  test("non-retryable errors are not retried", async () => {
    let calls = 0;
    await assert.rejects(() => with_transaction(fake_pool(), async () => {
      calls += 1;
      throw Object.assign(new Error("dup"), { errno: 1062 });
    }, no_wait));
    assert.equal(calls, 1);
  });
});

describe("ordered_locks", () => {
  test("sorts venue, club, booking, event, participation and ids ascending", () => {
    const sorted = ordered_locks([
      { type: "event", id: 9 }, { type: "club", id: 2 }, { type: "venue", id: 4 },
      { type: "event", id: 3 }, { type: "booking", id: 7 }, { type: "club", id: 2 },
    ]);
    assert.deepEqual(sorted.map(({ type, id }) => `${type}${id}`),
      ["venue4", "club2", "booking7", "event3", "event9"]);
  });

  test("rejects unknown lock types", () => {
    assert.throws(() => ordered_locks([{ type: "user", id: 1 }]));
  });
});
