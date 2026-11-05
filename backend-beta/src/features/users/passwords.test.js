import assert from "node:assert/strict";
import test from "node:test";
import { hash_password, verify_password } from "./passwords.js";

test("password hashes verify only the matching password", async () => {
  const hash = await hash_password("student-password");

  assert.notEqual(hash, "student-password");
  assert.equal(await verify_password("student-password", hash), true);
  assert.equal(await verify_password("different-password", hash), false);
});

test("placeholder and malformed hashes are rejected", async () => {
  assert.equal(await verify_password("password", "alpha-demo-only"), false);
  assert.equal(await verify_password("password", "invalid:hash"), false);
});
