import {
  create_user,
  delete_user,
  find_user_by_email,
  find_user_by_id,
  find_user_by_id_for_auth,
  update_user_account,
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

async function update_account(user_id, details) {
  const user = await find_user_by_id_for_auth(user_id);
  if (!user) {
    return { ok: false, reason: "not_found" };
  }
  if (
    details.new_password &&
    !(await verify_password(details.current_password, user.password_hash))
  ) {
    return { ok: false, reason: "incorrect_password" };
  }

  const password_hash = details.new_password
    ? await hash_password(details.new_password)
    : user.password_hash;
  const result = await update_user_account(user_id, {
    name: details.name.trim(),
    email: details.email.trim().toLowerCase(),
    password_hash,
  });
  if (!result.ok) {
    return result;
  }

  return { ok: true, user: await get_current_user(user_id) };
}

async function delete_account(user_id, current_password) {
  const user = await find_user_by_id_for_auth(user_id);
  if (!user) {
    return { ok: false, reason: "not_found" };
  }
  if (!(await verify_password(current_password, user.password_hash))) {
    return { ok: false, reason: "incorrect_password" };
  }
  if (!(await delete_user(user_id))) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}

export {
  delete_account,
  get_current_user,
  login_user,
  register_user,
  update_account,
};
