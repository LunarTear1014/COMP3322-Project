import { create_password_hasher, create_throttle } from "../features/users/password_hasher.js";
import { create_auth_router } from "./auth.js";
import { identify } from "./common.js";
import { create_clubs_router } from "./clubs.js";
import { create_events_router } from "./events.js";
import { create_registration_router } from "./registration.js";

// Assembles every v1 router for create_app({ v1_routers }). `clock()` returns
// the current Date (injectable for tests). Route modules are added here as they
// are built, in the order the pipeline needs.
function create_v1_stack({
  pool,
  clock = () => new Date(),
  hasher = create_password_hasher(),
  cover_dir = process.env.COVER_DIR || "./data/covers",
  hub = null,
  throttle_limits = { login: 10, register: 20, ip: 100 },
} = {}) {
  const window_ms = 15 * 60_000;
  const deps = {
    pool, clock, hasher, cover_dir, hub,
    login_throttle: create_throttle({ limit: throttle_limits.login, window_ms }),
    register_throttle: create_throttle({ limit: throttle_limits.register, window_ms }),
    ip_throttle: create_throttle({ limit: throttle_limits.ip, window_ms }),
  };
  const routers = [identify(pool), create_auth_router(deps), create_clubs_router(deps), create_events_router(deps), create_registration_router(deps)];
  return { deps, routers, is_multipart_route: () => false };
}

export { create_v1_stack };
