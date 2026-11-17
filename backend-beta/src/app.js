import express from "express";
import session from "express-session";
import { create_v1_router } from "./api_v1/router.js";
import { origin_and_csrf } from "./middleware/csrf.js";
import { error_handler, not_found_handler } from "./middleware/error_handler.js";
import { json_body } from "./middleware/json_body.js";
import request_id from "./middleware/request_id.js";

// Injectable app factory (backend.md section 1). Importing this module opens
// no sockets and touches no database; index.js supplies the real pieces.
//   legacy_routers: the unversioned /api routers kept for the beta frontend
//   session_store:  optional express-session store (defaults to memory)
function create_app({
  session_secret,
  app_origin,
  legacy_routers = [],
  v1_routers = [],
  legacy_google_mounts = [],
  is_multipart_route = () => false,
  session_store,
  cookie_secure = false,
  trust_proxy = false,
  logger = console,
} = {}) {
  if (!session_secret) throw new Error("session_secret is required");

  const app = express();
  app.disable("x-powered-by");
  if (trust_proxy) app.set("trust proxy", 1);

  app.use(request_id());

  // Legacy beta routes keep their own body parsing and error shapes until the
  // frontend cutover; they are mounted before the v1 pipeline.
  const v1 = express.Router();
  const session_middleware = session({
    name: "clubspace.sid",
    secret: session_secret,
    store: session_store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: cookie_secure,
      maxAge: 24 * 60 * 60 * 1000,
    },
  });

  // Order (backend.md section 2): body limits -> session -> Origin/CSRF -> ...
  // Multipart routes (event covers) parse their own body, after the CSRF check.
  v1.use(json_body({ skip: is_multipart_route }));
  v1.use(session_middleware);
  v1.use(origin_and_csrf({ app_origin }));
  v1.use(create_v1_router());
  for (const router of v1_routers) v1.use(router);
  v1.use(not_found_handler);
  v1.use(error_handler({ logger }));
  app.use("/api/v1", v1);

  if (legacy_routers.length || legacy_google_mounts.length) {
    app.use(express.json());
    app.use(session_middleware);
    // The Google callback redirect lands on the frontend-facing /api/auth
    // prefix; mount the same session-aware router there (GET-only routes, no
    // CSRF/origin check needed — same policy as the /api/v1 mount).
    for (const [prefix, router] of legacy_google_mounts) app.use(prefix, router);
    for (const router of legacy_routers) app.use(router);
  }

  app.use(not_found_handler);
  app.use(error_handler({ logger }));
  return app;
}

export { create_app };
