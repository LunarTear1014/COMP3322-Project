import { create_app } from "../src/app.js";
import { create_utc_pool } from "../src/db/pool.js";
import { create_password_hasher } from "../src/features/users/password_hasher.js";
import { MysqlSessionStore } from "../src/api_v1/session_store.js";
import { create_v1_stack } from "../src/api_v1/stack.js";
import { prepare_database } from "./db_helper.js";

const ORIGIN = "http://app.test";
const FAST_HASH = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let counter = 0;

// A cookie-and-CSRF aware HTTP client for the real v1 app.
class Client {
  constructor(base) { this.base = base; this.cookie = ""; this.csrf = null; }

  async request(method, path, body, { headers = {}, raw = false } = {}) {
    const options = { method, headers: { Origin: ORIGIN, ...headers } };
    if (this.cookie) options.headers.Cookie = this.cookie;
    if (method !== "GET") {
      if (!this.csrf) await this.refresh_csrf();
      options.headers["X-CSRF-Token"] = this.csrf;
      if (!raw) options.headers["Content-Type"] = "application/json";
      options.body = raw ? body : JSON.stringify(body ?? {});
      if (this.cookie) options.headers.Cookie = this.cookie;
    }
    const response = await fetch(`${this.base}/api/v1${path}`, options);
    const set = response.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }

  get(path) { return this.request("GET", path); }
  post(path, body) { return this.request("POST", path, body); }
  put(path, body) { return this.request("PUT", path, body); }
  patch(path, body) { return this.request("PATCH", path, body); }
  delete(path, body) { return this.request("DELETE", path, body ?? {}); }

  async refresh_csrf() {
    const result = await this.request("GET", "/auth/csrf");
    this.csrf = result.body.data.csrf_token;
  }

  async login(email, password = "correct-horse-1") {
    if (!this.csrf) await this.refresh_csrf();
    const result = await this.post("/auth/login", { email, password });
    if (result.status === 200) this.csrf = result.body.data.csrf_token;
    return result;
  }
}

// Boots the app on a fresh, migrated disposable database. `now` is a mutable
// clock: `app.set_now(date)`.
async function start_v1({ migrate = true, hasher_params = FAST_HASH, throttle_limits } = {}) {
  const db = await prepare_database({ migrate });
  const pool = create_utc_pool({ ...db.config, connection_limit: 12 });
  let now = new Date("2026-11-16T00:00:00Z");
  const hasher = create_password_hasher({ params: hasher_params });
  const stack = create_v1_stack({ pool, hasher, hub_options: { interval_ms: 50, logger: { error() {} } }, clock: () => (now = new Date(now.getTime() + 1)), throttle_limits, cover_dir: `${process.env.TMPDIR || "/tmp"}/clubspace-test-covers-${process.pid}-${counter++}` });
  await stack.start();
  const store = new MysqlSessionStore({ pool, cleanup_ms: 0 });
  const app = create_app({
    session_secret: "s".repeat(32), app_origin: ORIGIN, session_store: store,
    v1_routers: stack.routers, is_multipart_route: stack.is_multipart_route, logger: { error() {} },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const hash = (password) => hasher.hash(password);

  async function user({ email, name = "User", student_id, platform_role = "student", password = "correct-horse-1" }) {
    const [result] = await db.admin.query(
      "INSERT INTO users (email, password_hash, name, student_id, platform_role) VALUES (?, ?, ?, ?, ?)",
      [email, await hash(password), name, student_id ?? email.split("@")[0], platform_role]);
    return result.insertId;
  }
  async function client_for(email) {
    const client = new Client(base);
    const result = await client.login(email);
    if (result.status !== 200) throw new Error(`login failed for ${email}: ${result.status}`);
    return client;
  }
  return {
    ...db, pool, base, stack, store, user, client_for, hasher,
    client: () => new Client(base),
    set_now: (date) => { now = date; },
    get_now: () => now,
    async stop() { stack.stop(); server.closeAllConnections?.(); server.close(); store.close(); await pool.end(); await db.close(); },
  };
}

export { Client, ORIGIN, start_v1 };
