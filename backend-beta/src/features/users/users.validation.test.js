import assert from "node:assert/strict";
import test from "node:test";
import {
  validate_account_deletion,
  validate_account_update,
  validate_registration,
} from "./users.validation.js";

const valid_registration = {
  name: "Student",
  email: "student@example.com",
  student_id: "s1234567",
  password: "student-password",
  confirm_password: "student-password",
};

test("registration requires matching password confirmation", () => {
  assert.equal(validate_registration(valid_registration), null);
  assert.equal(
    validate_registration({
      ...valid_registration,
      confirm_password: "different-password",
    }),
    "Passwords do not match.",
  );
});

test("account detail updates do not need a password", () => {
  const details = {
    name: "Student",
    email: "student@example.com",
  };
  assert.equal(validate_account_update(details), null);
});

test("password changes require the current password and matching confirmation", () => {
  assert.equal(
    validate_account_update({
      name: "Student",
      email: "student@example.com",
      current_password: "",
      new_password: "new-password",
      confirm_password: "new-password",
    }),
    "Enter your current password to change your password.",
  );
  assert.equal(
    validate_account_update({
      name: "Student",
      email: "student@example.com",
      current_password: "current-password",
      new_password: "new-password",
      confirm_password: "different-password",
    }),
    "New passwords do not match.",
  );
});

test("account deletion requires a password", () => {
  assert.equal(
    validate_account_deletion({ current_password: "current-password" }),
    null,
  );
  assert.equal(validate_account_deletion({}), "Enter your password to delete your account.");
});
