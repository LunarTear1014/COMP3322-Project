import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { describe, test } from "node:test";
import { create_password_hasher, create_throttle } from "./password_hasher.js";
import { hash_password } from "./passwords.js";

// Cheap parameters keep unit tests fast; one test checks the real defaults.
const fast = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

describe("password hasher", () => {
  test("hashes with versioned parameters and verifies only the right password", async () => {
    const hasher = create_password_hasher({ params: fast });
    const stored = await hasher.hash("correct horse battery");
    assert.match(stored, /^scrypt\$v1\$N=16384,r=8,p=1\$[\w-]{22}\$[\w-]{86}$/);
    assert.deepEqual(await hasher.verify("correct horse battery", stored), { ok: true, needs_rehash: false });
    assert.equal((await hasher.verify("wrong password!!", stored)).ok, false);
    assert.notEqual(stored, await hasher.hash("correct horse battery"), "random salt");
  });

  test("passwords are not trimmed", async () => {
    const hasher = create_password_hasher({ params: fast });
    const stored = await hasher.hash(" spaced password ");
    assert.equal((await hasher.verify("spaced password", stored)).ok, false);
    assert.equal((await hasher.verify(" spaced password ", stored)).ok, true);
  });

  test("the real defaults use N=131072 and finish within a few seconds", async () => {
    const hasher = create_password_hasher();
    const started = performance.now();
    const stored = await hasher.hash("a-long-enough-password");
    const elapsed = performance.now() - started;
    assert.match(stored, /^scrypt\$v1\$N=131072,r=8,p=1\$/);
    assert.ok(elapsed < 5000, `hash took ${Math.round(elapsed)} ms`);
    console.log(`# benchmark: one N=131072 hash took ${Math.round(elapsed)} ms (128 MiB working set)`);
  });

  test("unknown account, malformed and placeholder hashes fail without throwing", async () => {
    const hasher = create_password_hasher({ params: fast });
    for (const stored of [null, undefined, "", "!", "placeholder", "scrypt$v1$bad", `${"0".repeat(32)}:${"0".repeat(10)}`]) {
      assert.deepEqual(await hasher.verify("whatever-password", stored), { ok: false, needs_rehash: false });
    }
  });

  test("tampered parameters that would exhaust memory are rejected", async () => {
    const hasher = create_password_hasher({ params: fast });
    const salt = randomBytes(16).toString("base64url");
    const key = randomBytes(64).toString("base64url");
    for (const params of ["N=1073741824,r=8,p=1", "N=16384,r=1024,p=1", "N=16385,r=8,p=1", "N=16384,r=8,p=64"]) {
      const result = await hasher.verify("x".repeat(12), `scrypt$v1$${params}$${salt}$${key}`);
      assert.equal(result.ok, false, params);
    }
  });

  test("legacy beta hashes still verify and ask for a rehash", async () => {
    const hasher = create_password_hasher({ params: fast });
    const legacy = await hash_password("legacy-password-1");
    assert.deepEqual(await hasher.verify("legacy-password-1", legacy), { ok: true, needs_rehash: true });
    assert.deepEqual(await hasher.verify("nope", legacy), { ok: false, needs_rehash: false });
  });

  test("a weaker stored cost asks for a rehash after a successful login", async () => {
    const weak = create_password_hasher({ params: { ...fast, N: 2 ** 14 } });
    const strong = create_password_hasher({ params: { ...fast, N: 2 ** 15 } });
    const stored = await weak.hash("some-password-123");
    assert.deepEqual(await strong.verify("some-password-123", stored), { ok: true, needs_rehash: true });
  });

  test("a stored hash matches an independent scrypt computation", async () => {
    const hasher = create_password_hasher({ params: fast });
    const stored = await hasher.hash("independent-check-1");
    const [, , , salt, key] = stored.split("$");
    const expected = scryptSync("independent-check-1", Buffer.from(salt, "base64url"), 64, fast);
    assert.equal(expected.toString("base64url"), key);
  });
});

describe("hash queue", () => {
  test("runs at most 2 at once, queues 10, and the 13th gets 503 AUTH_BUSY", async () => {
    const hasher = create_password_hasher({ params: fast });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let running = 0;
    let peak = 0;
    const task = () => hasher.limiter.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate;
      running -= 1;
    });
    const accepted = Array.from({ length: 12 }, task);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(running, 2);
    await assert.rejects(task, (error) => error.code === "AUTH_BUSY" && error.status === 503);
    release();
    await Promise.all(accepted);
    assert.equal(peak, 2);
    assert.equal(hasher.limiter.active, 0);
    assert.equal(hasher.limiter.waiting.length, 0);
  });
});

describe("throttle", () => {
  test("allows 10 attempts per window, then 429 with Retry-After, then recovers", () => {
    let time = 0;
    const throttle = create_throttle({ limit: 10, window_ms: 15 * 60_000, now: () => time });
    for (let i = 0; i < 10; i += 1) { throttle.hit("a@x|1.1.1.1"); time += 1000; }
    try {
      throttle.hit("a@x|1.1.1.1");
      assert.fail("expected throttling");
    } catch (error) {
      assert.equal(error.status, 429);
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.headers["Retry-After"], String(15 * 60 - 10));
    }
    throttle.hit("b@x|1.1.1.1"); // other keys are independent
    time = 15 * 60_000 + 1;
    throttle.hit("a@x|1.1.1.1");
  });
});
