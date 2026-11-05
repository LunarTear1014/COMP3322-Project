import { invalid_request, database_error } from "../../shared/http.js";
import { validate_user_update, normalize_user_update } from "./users.validation.js";
import { get_current_user, update_current_user } from "./users.service.js";

// GET /api/user/me
async function show_current_user(_req, res) {
  try {
    const user = await get_current_user();
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
    const result = await update_current_user(name, email);
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

export { show_current_user, update_current_user_handler };
