import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "../../shared/errors.js";
import { verify_password as verify_legacy } from "./passwords.js";

// v1 password hashing (backend.md section 2): async scrypt, a random 16-byte
// salt, a 64-byte result, and the parameters stored with the hash so they can
// be raised later. At most `concurrency` hashes run at once; up to
// `max_queue` more wait; beyond that callers get 503 AUTH_BUSY.
//
// Stored format: scrypt$v1$N=131072,r=8,p=1$<salt base64url>$<key base64url>
// Legacy beta hashes (`<salt hex>:<key hex>`, scrypt defaults) still verify and
// are reported as needing a rehash. Placeholder values never verify.

const scrypt_async = promisify(scrypt);

const DEFAULT_PARAMS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const FORMAT = /^scrypt\$v1\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

class Limiter {
  constructor({ concurrency, max_queue }) {
    this.concurrency = concurrency;
    this.max_queue = max_queue;
    this.active = 0;
    this.waiting = [];
  }

  async run(task) {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.max_queue) {
        throw new ApiError("AUTH_BUSY", "Sign-in is busy. Try again in a moment.", {
          headers: { "Retry-After": "5" },
        });
      }
      await new Promise((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // hand the slot straight to the next waiter
      else this.active -= 1;
    }
  }
}

function create_password_hasher({ params = DEFAULT_PARAMS, concurrency = 2, max_queue = 10 } = {}) {
  const limiter = new Limiter({ concurrency, max_queue });
  const options = { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem };

  async function derive(password, salt, { N, r, p }) {
    return scrypt_async(password, salt, KEY_BYTES, { N, r, p, maxmem: params.maxmem });
  }

  return {
    limiter,
    async hash(password) {
      return limiter.run(async () => {
        const salt = randomBytes(SALT_BYTES);
        const key = await derive(password, salt, options);
        return `scrypt$v1$N=${options.N},r=${options.r},p=${options.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
      });
    },

    // Returns { ok, needs_rehash }. A missing stored hash (unknown email)
    // still spends a full derivation so timing does not reveal the account.
    async verify(password, stored) {
      const parsed = parse(stored);
      if (!parsed) {
        await limiter.run(() => derive(password, DUMMY_SALT, options));
        return { ok: false, needs_rehash: false };
      }
      if (parsed.legacy) {
        const ok = await limiter.run(() => verify_legacy(password, stored));
        return { ok, needs_rehash: ok };
      }
      return limiter.run(async () => {
        const actual = await derive(password, parsed.salt, parsed.params);
        const ok = actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
        const weaker = parsed.params.N < options.N || parsed.params.r < options.r || parsed.params.p < options.p;
        return { ok, needs_rehash: ok && weaker };
      });
    },
  };
}

const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 7);

function parse(stored) {
  if (typeof stored !== "string") return null;
  if (/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return { legacy: true };
  const match = FORMAT.exec(stored);
  if (!match) return null;
  const [N, r, p] = match.slice(1, 4).map(Number);
  // Refuse stored parameters that would let a tampered row exhaust memory.
  if (N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4) return null;
  const salt = Buffer.from(match[4], "base64url");
  const key = Buffer.from(match[5], "base64url");
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
  return { legacy: false, params: { N, r, p }, salt, key };
}

// Login and registration throttle (backend.md): `limit` attempts per window per
// key (email+IP, and IP alone with a larger limit). In-memory, single replica.
function create_throttle({ limit, window_ms, now = () => Date.now() }) {
  const buckets = new Map();
  return {
    // Records an attempt; throws RATE_LIMITED with Retry-After when exceeded.
    hit(key) {
      const time = now();
      const bucket = (buckets.get(key) ?? []).filter((at) => time - at < window_ms);
      if (bucket.length >= limit) {
        const retry = Math.max(1, Math.ceil((bucket[0] + window_ms - time) / 1000));
        buckets.set(key, bucket);
        throw new ApiError("RATE_LIMITED", "Too many attempts. Try again later.", {
          headers: { "Retry-After": String(retry) },
        });
      }
      bucket.push(time);
      buckets.set(key, bucket);
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}

export { DEFAULT_PARAMS, create_password_hasher, create_throttle };
