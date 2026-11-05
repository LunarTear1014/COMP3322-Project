import { invalid_request, database_error } from "../../shared/http.js";
import {
  normalize_email,
  validate_login,
  validate_registration,
  validate_account_update,
  validate_account_deletion,
} from "./users.validation.js";
import {
  delete_account,
  get_current_user,
  login_user,
  register_user,
  update_account,
} from "./users.service.js";

function regenerate_session(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function register_handler(req, res) {
  const message = validate_registration(req.body);
  if (message) {
    return invalid_request(res, message);
  }

  const { name, email, student_id, password } = req.body;
  try {
    const result = await register_user({
      name: name.trim(),
      email: normalize_email(email),
      student_id: student_id.trim(),
      password,
    });
    if (!result.ok) {
      const message =
        result.reason === "duplicate_student_id"
          ? "That student ID is already registered."
          : "That email address is already registered.";
      return res.status(409).json({ message });
    }

    await regenerate_session(req);
    req.session.user_id = result.user.id;
    return res.status(201).json(result.user);
  } catch (error) {
    return database_error(res, error);
  }
}

async function login_handler(req, res) {
  const message = validate_login(req.body);
  if (message) {
    return invalid_request(res, message);
  }

  try {
    const user = await login_user(
      normalize_email(req.body.email),
      req.body.password,
    );
    if (!user) {
      return res.status(401).json({ message: "Email or password is incorrect." });
    }
    await regenerate_session(req);
    req.session.user_id = user.id;
    return res.json(user);
  } catch (error) {
    return database_error(res, error);
  }
}

function logout_handler(req, res) {
  req.session.destroy((error) => {
    if (error) {
      return database_error(res, error);
    }
    res.clearCookie("clubspace.sid");
    return res.status(204).end();
  });
}

async function current_account_handler(req, res) {
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "You are not logged in." });
  }
  try {
    const user = await get_current_user(req.session.user_id);
    if (!user) {
      return res.status(401).json({ message: "You are not logged in." });
    }
    return res.json(user);
  } catch (error) {
    return database_error(res, error);
  }
}

async function update_account_handler(req, res) {
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "You are not logged in." });
  }
  const message = validate_account_update(req.body);
  if (message) {
    return invalid_request(res, message);
  }

  try {
    const result = await update_account(req.session.user_id, req.body);
    if (result.ok) {
      return res.json(result.user);
    }
    if (result.reason === "not_found") {
      return res.status(401).json({ message: "You are not logged in." });
    }
    if (result.reason === "incorrect_password") {
      return res.status(401).json({ message: "Your current password is incorrect." });
    }
    return res.status(409).json({ message: "That email address is already in use." });
  } catch (error) {
    return database_error(res, error);
  }
}

async function delete_account_handler(req, res) {
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "You are not logged in." });
  }
  const message = validate_account_deletion(req.body);
  if (message) {
    return invalid_request(res, message);
  }

  try {
    const result = await delete_account(
      req.session.user_id,
      req.body.current_password,
    );
    if (!result.ok) {
      if (result.reason === "incorrect_password") {
        return res.status(401).json({ message: "Your password is incorrect." });
      }
      return res.status(401).json({ message: "You are not logged in." });
    }

    req.session.destroy((error) => {
      if (error) {
        return database_error(res, error);
      }
      res.clearCookie("clubspace.sid");
      return res.status(204).end();
    });
  } catch (error) {
    return database_error(res, error);
  }
}

export {
  current_account_handler,
  delete_account_handler,
  login_handler,
  logout_handler,
  register_handler,
  update_account_handler,
};
