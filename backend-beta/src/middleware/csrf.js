import { randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "../shared/errors.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function new_token() {
  return randomBytes(32).toString("base64url");
}

function tokens_match(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Returns the session's CSRF token, creating one if needed.
function ensure_csrf_token(req) {
  if (!req.session.csrf_token) req.session.csrf_token = new_token();
  return req.session.csrf_token;
}

// Login must replace the token together with the regenerated session.
function rotate_csrf_token(req) {
  req.session.csrf_token = new_token();
  return req.session.csrf_token;
}

// Every browser mutation needs the exact configured Origin and the token that
// belongs to the session. The order follows handoff/api.md section 1 (after
// parse/media limits, before authentication).
function origin_and_csrf({ app_origin }) {
  // Without a configured origin every mutation fails closed.
  return (req, _res, next) => {
    if (!MUTATING.has(req.method)) return next();
    if (!app_origin || req.headers.origin !== app_origin) {
      return next(new ApiError("ORIGIN_INVALID", "This request came from an unexpected origin."));
    }
    if (!tokens_match(req.session?.csrf_token, req.get("x-csrf-token"))) {
      return next(new ApiError("CSRF_INVALID", "Your session token expired. Refresh and try again."));
    }
    next();
  };
}

export { ensure_csrf_token, origin_and_csrf, rotate_csrf_token, tokens_match };
