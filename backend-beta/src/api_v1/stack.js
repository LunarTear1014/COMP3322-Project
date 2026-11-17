import { create_password_hasher, create_throttle } from "../features/users/password_hasher.js";
import { create_auth_router } from "./auth.js";
import { create_google_router } from "./google.js";
import { identify } from "./common.js";
import { create_clubs_router } from "./clubs.js";
import { create_events_router } from "./events.js";
import { create_registration_router } from "./registration.js";
import { create_notifications_router } from "./notifications.js";
import { create_calendar_router } from "./calendar_reports.js";
import { create_engagement_router } from "./engagement.js";
import { IS_COVER_UPLOAD, create_covers_router } from "./covers_routes.js";
import { NotificationStreamHub } from "../features/notifications/stream_hub.js";
import { create_notifications_repository } from "../features/notifications/notifications.repository.js";
import { create_stream_router } from "../features/notifications/stream.routes.js";

// Assembles every v1 router for create_app({ v1_routers }). `clock()` returns
// the current Date (injectable for tests). Route modules are added here as they
// are built, in the order the pipeline needs.
function create_v1_stack({
  pool,
  clock = () => new Date(),
  hasher = create_password_hasher(),
  cover_dir = process.env.COVER_DIR || "./data/covers",
  hub_options = {},
  throttle_limits = { login: 10, register: 20, ip: 100 },
  google_client = { enabled: false },
  app_origin = null,
} = {}) {
  const window_ms = 15 * 60_000;
  const hub = new NotificationStreamHub({ repository: create_notifications_repository(pool), ...hub_options });
  const deps = {
    pool, clock, hasher, cover_dir, hub,
    login_throttle: create_throttle({ limit: throttle_limits.login, window_ms }),
    register_throttle: create_throttle({ limit: throttle_limits.register, window_ms }),
    ip_throttle: create_throttle({ limit: throttle_limits.ip, window_ms }),
  };
  const google_router = create_google_router({ google_client, app_origin, ip_throttle: deps.ip_throttle, pool });
  // The Google routes 404 as a pair when credentials are missing, so the
  // public config endpoint must surface whether they exist at all — the
  // frontend uses it to show or hide the "Continue with Google" button.
  const google_oauth_enabled = !google_router.__google_disabled;
  const routers = [identify(pool), create_auth_router(deps), create_clubs_router(deps), create_events_router(deps), create_registration_router(deps),
    create_notifications_router(deps), create_calendar_router(deps), create_engagement_router(deps), create_covers_router(deps),
    google_router,
    create_stream_router({ hub, authenticate: async (req) => req.user?.id ?? null })];
  // Google's redirect lands on the frontend-facing /api/auth/google/callback
  // (the same /api prefix the legacy beta routers use), not /api/v1; expose
  // the router so index.js can mount it at that exact path too.
  const extra_mounts = app_origin ? [["/api/auth", google_router]] : [];
  return { deps, routers, extra_mounts, hub, google_oauth_enabled, is_multipart_route: IS_COVER_UPLOAD, start: () => hub.start(), stop: () => hub.stop() };
}

export { create_v1_stack };
