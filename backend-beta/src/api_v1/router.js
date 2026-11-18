import express from "express";
import { ensure_csrf_token } from "../middleware/csrf.js";
import { ApiError } from "../shared/errors.js";
import { config_payload } from "../shared/slots.js";

// Registers `path` with a handler per method and answers 405 + Allow for any
// other method, as handoff/api.md requires.
function define_route(router, path, handlers) {
  const route = router.route(path);
  for (const [method, handler] of Object.entries(handlers)) {
    route[method](handler);
  }
  const allowed = Object.keys(handlers).map((method) => method.toUpperCase()).join(", ");
  route.all((_req, _res, next) => {
    next(new ApiError("METHOD_NOT_ALLOWED", "That method is not supported here.", {
      headers: { Allow: allowed },
    }));
  });
}

// v1 router. Business resources are added by later tasks; only the shared
// public endpoints live here today.
function create_v1_router({ google_oauth_enabled = false } = {}) {
  const router = express.Router();

  define_route(router, "/config", {
    get: (_req, res) => res.json({ data: config_payload({ google_oauth_enabled }) }),
  });

  define_route(router, "/auth/csrf", {
    get: (req, res) => {
      const csrf_token = ensure_csrf_token(req);
      res.json({ data: { csrf_token } });
    },
  });

  return router;
}

export { create_v1_router, define_route };
