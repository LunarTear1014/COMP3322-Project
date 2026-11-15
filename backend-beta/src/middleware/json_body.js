import express from "express";
import { ApiError } from "../shared/errors.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BODY_LIMIT = "64kb";

// Bounded JSON parsing. Mutations must declare application/json, including
// `{}` on empty actions. `skip(req)` lets multipart routes opt out.
function json_body({ skip = () => false } = {}) {
  const parser = express.json({ limit: BODY_LIMIT, strict: true, type: () => true });
  return (req, res, next) => {
    if (skip(req) || !MUTATING.has(req.method)) return next();
    const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return next(new ApiError("UNSUPPORTED_MEDIA_TYPE", "Send application/json."));
    }
    parser(req, res, (error) => {
      if (error) return next(error);
      const body = req.body;
      if (body === undefined || body === null || Array.isArray(body) || typeof body !== "object") {
        return next(new ApiError("VALIDATION_FAILED", "The body must be a JSON object.", {
          fields: { body: "Send a JSON object." },
        }));
      }
      next();
    });
  };
}

export { json_body, BODY_LIMIT };
