import express from "express";
import { define_route } from "../../api_v1/router.js";
import { ApiError } from "../../shared/errors.js";
import { parse_last_event_id } from "./stream_hub.js";

// GET /api/v1/notifications/stream. A GET needs no CSRF token. `authenticate`
// resolves the signed-in user id from the request (throws 401 otherwise).
function create_stream_router({ hub, authenticate }) {
  const router = express.Router();
  define_route(router, "/notifications/stream", {
    get: async (req, res, next) => {
      try {
        const user_id = await authenticate(req);
        if (!user_id) throw new ApiError("AUTHENTICATION_REQUIRED", "Sign in to continue.");
        const last_event_id = parse_last_event_id(req.get("last-event-id"));
        await hub.connect({ user_id, last_event_id, req, res });
      } catch (error) {
        next(error);
      }
    },
  });
  return router;
}

export { create_stream_router };
