// Returns the first validation error message for a PUT /api/user/me body,
// or null when the input is valid. The checks and their order mirror the
// original handler verbatim.
function validate_user_update({ name, email }) {
  if (typeof name !== "string" || name.trim() === "") {
    return "Name is required";
  }
  if (typeof email !== "string" || !email.includes("@")) {
    return "Enter a valid email address";
  }
  return null;
}

// Returns the validated name and email with surrounding whitespace removed.
// Call only after validate_user_update has accepted the body.
function normalize_user_update({ name, email }) {
  return { name: name.trim(), email: email.trim() };
}

export { validate_user_update, normalize_user_update };
