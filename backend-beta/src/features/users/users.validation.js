function valid_email(email) {
  return (
    typeof email === "string" &&
    email.trim().length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

function validate_registration(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Registration details are required.";
  }
  if (
    typeof body.name !== "string" ||
    body.name.trim() === "" ||
    body.name.trim().length > 255
  ) {
    return "Name is required.";
  }
  if (!valid_email(body.email)) {
    return "Enter a valid email address.";
  }
  if (
    typeof body.student_id !== "string" ||
    body.student_id.trim() === "" ||
    body.student_id.trim().length > 50
  ) {
    return "Student ID is required.";
  }
  if (
    typeof body.password !== "string" ||
    body.password.length < 8 ||
    body.password.length > 128
  ) {
    return "Password must be between 8 and 128 characters.";
  }
  return null;
}

function validate_login(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !valid_email(body.email) ||
    typeof body.password !== "string" ||
    body.password.length === 0 ||
    body.password.length > 128
  ) {
    return "Enter a valid email address and password.";
  }
  return null;
}

function normalize_email(email) {
  return email.trim().toLowerCase();
}

export {
  normalize_email,
  validate_login,
  validate_registration,
};
