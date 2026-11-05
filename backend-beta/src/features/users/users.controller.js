import { invalid_request, database_error } from "../../shared/http.js";
import {
  normalize_email,
  validate_login,
  validate_registration,
  validate_user_update,
  normalize_user_update,
} from "./users.validation.js";
import {
  get_current_user,
  login_user,
  register_user,
  update_current_user,
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

// GET /api/user/me
async function show_current_user(req, res) {
  try {
    const user = await get_current_user(req.session?.user_id);
    if (!user) {
      return res.status(404).json({ message: "Demo user was not found." });
    }
    res.json(user);
  } catch (error) {
    database_error(res, error);
  }
}

// PUT /api/user/me
async function update_current_user_handler(req, res) {
  const message = validate_user_update(req.body);
  if (message) {
    return invalid_request(res, message);
  }
  const { name, email } = normalize_user_update(req.body);

  try {
    const result = await update_current_user(
      name,
      email,
      req.session?.user_id,
    );
    if (!result.ok) {
      if (result.reason === "not_found") {
        return res.status(404).json({ message: "Demo user was not found." });
      }
      return res
        .status(409)
        .json({ message: "That email address is already in use." });
    }
    res.json(result.user);
  } catch (error) {
    database_error(res, error);
  }
}

export {
  current_account_handler,
  login_handler,
  logout_handler,
  register_handler,
  show_current_user,
  update_current_user_handler,
};
