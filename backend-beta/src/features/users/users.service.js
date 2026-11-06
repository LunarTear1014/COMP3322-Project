import {
  create_user,
  delete_user,
  find_user_by_email,
  find_user_by_id,
  find_user_by_id_for_auth,
  update_user_account,
} from "./users.repository.js";
import { hash_password, verify_password } from "./passwords.js";
const dummy_hash = "3555d60561c0bcf4bb4e1f114023015f:36e8974b28b5baa5f6cd4648c4538418d9e333e77a0a8a83b1ee6098b557c5ffd9e70e0406fe9634d6972c1aa371711ca08c611592672e6ed939ccaafd4e81f7";

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
    user: { id: result.user_id, name, email, student_id, platform_role: "student" },
  };
}

async function login_user(email, password) {
  const user = await find_user_by_email(email);
  const valid_hash = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(user?.password_hash || "");
  const matched = await verify_password(password, valid_hash ? user.password_hash : dummy_hash);
  if (!user || !valid_hash || !matched) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    student_id: user.student_id,
    platform_role: user.platform_role,
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
