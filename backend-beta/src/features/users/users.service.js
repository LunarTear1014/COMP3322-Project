import {
  create_user,
  find_user_by_email,
  find_user_by_id,
  update_user,
  user_exists,
} from "./users.repository.js";
import { hash_password, verify_password } from "./passwords.js";

async function register_user({ name, email, student_id, password }) {
  const password_hash = await hash_password(password);
  const result = await create_user({
    name,
    email,
    student_id,
    password_hash,
  });
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    user: { id: result.user_id, name, email, student_id },
  };
}

async function login_user(email, password) {
  const user = await find_user_by_email(email);
  if (!user || !(await verify_password(password, user.password_hash))) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    student_id: user.student_id,
  };
}

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
async function get_current_user(user_id = demo_user_id) {
  const user = await find_user_by_id(user_id);
  return user ?? null;
}

// Returns { ok: true, user }, { ok: false, reason: "not_found" }, or
// { ok: false, reason: "duplicate_email" }. Other database errors are rethrown.
// name and email arrive already trimmed from the validation layer.
async function update_current_user(
  name,
  email,
  user_id = demo_user_id,
) {
  if (!(await user_exists(user_id))) {
    return { ok: false, reason: "not_found" };
  }

  const result = await update_user(user_id, name, email);
  if (!result.ok) {
    return result;
  }
  const user = await find_user_by_id(user_id);
  return { ok: true, user };
}

export { get_current_user, login_user, register_user, update_current_user };
