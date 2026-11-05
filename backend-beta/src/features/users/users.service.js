import { user_exists, find_user_by_id, update_user } from "./users.repository.js";

// The demo user is used until the login feature supplies an authenticated user id.
const parsed_demo_user_id = Number(process.env.DEMO_USER_ID || 1);

if (!Number.isInteger(parsed_demo_user_id) || parsed_demo_user_id < 1) {
  throw new Error(
    `DEMO_USER_ID must be a positive integer, got: ${process.env.DEMO_USER_ID ?? "(unset)"}. ` +
      "Check the value in .env.",
  );
}

const demo_user_id = parsed_demo_user_id;

// Returns the current user, or null when the demo user does not exist.
async function get_current_user() {
  const user = await find_user_by_id(demo_user_id);
  return user ?? null;
}

// Returns { ok: true, user }, { ok: false, reason: "not_found" }, or
// { ok: false, reason: "duplicate_email" }. Other database errors are rethrown.
// name and email arrive already trimmed from the validation layer.
async function update_current_user(name, email) {
  if (!(await user_exists(demo_user_id))) {
    return { ok: false, reason: "not_found" };
  }

  const result = await update_user(demo_user_id, name, email);
  if (!result.ok) {
    return result;
  }
  return { ok: true, user: { name, email } };
}

export { get_current_user, update_current_user };
