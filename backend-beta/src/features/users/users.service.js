import {
  create_user,
  find_user_by_email,
  find_user_by_id,
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

async function get_current_user(user_id) {
  const user = await find_user_by_id(user_id);
  return user ?? null;
}

export { get_current_user, login_user, register_user };
