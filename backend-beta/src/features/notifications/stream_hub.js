import { ApiError } from "../../shared/errors.js";

// Live notification delivery over Server-Sent Events (beta-feedback.md
// section 4). The hub runs in the API process and tails the shared
// `notifications` table, so rows written by the worker or by another API
// process arrive the same way as rows written by this one.
//
// repository contract (SQL lives in notifications.repository.js):
//   max_id()                                 -> number
//   fetch_after(id, limit)                   -> rows ordered by id ascending
//   fetch_for_user_after(user_id, id, limit) -> that user's rows, ascending
//   unread_count(user_id)                    -> number
//   to_dto(row)                              -> wire Notification
//
// Auto-increment ids can commit out of order, so a row with a lower id than
// one already seen may appear a moment late. Each tick therefore re-reads a
// small look-back window and a bounded set of delivered ids suppresses repeats.

const DEFAULTS = {
  interval_ms: 1000,
  heartbeat_ms: 25_000,
  max_per_user: 3,
  replay_max: 200,
  batch: 500,
  lookback: 50,
  remembered_ids: 5000,
};

class NotificationStreamHub {
  constructor({ repository, logger = console, ...options }) {
    this.repository = repository;
    this.logger = logger;
    this.options = { ...DEFAULTS, ...options };
    this.clients = new Map(); // user_id -> Set<response>
    this.delivered = new Set();
    this.last_seen_max = 0;
    this.timer = null;
    this.heartbeat = null;
    this.ticking = false;
  }

  async start() {
    this.last_seen_max = await this.repository.max_id();
    this.timer = setInterval(() => void this.tick(), this.options.interval_ms);
    this.heartbeat = setInterval(() => this.ping(), this.options.heartbeat_ms);
    this.timer.unref?.();
    this.heartbeat.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }

  connection_count(user_id) {
    return this.clients.get(user_id)?.size ?? 0;
  }

  remember(id) {
    this.delivered.add(id);
    if (this.delivered.size > this.options.remembered_ids) {
      this.delivered.delete(this.delivered.values().next().value);
    }
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const from = Math.max(0, this.last_seen_max - this.options.lookback);
      const rows = await this.repository.fetch_after(from, this.options.batch);
      for (const row of rows) {
        this.last_seen_max = Math.max(this.last_seen_max, row.id);
        if (this.delivered.has(row.id)) continue;
        this.remember(row.id);
        const connections = this.clients.get(row.user_id);
        if (!connections?.size) continue;
        const unread = await this.repository.unread_count(row.user_id);
        const frame = sse("notification", row.id, { notification: this.repository.to_dto(row), unread_count: unread });
        for (const res of connections) res.write(frame);
      }
    } catch (error) {
      this.logger.error("notification stream tick failed", error?.message);
    } finally {
      this.ticking = false;
    }
  }

  ping() {
    for (const set of this.clients.values()) for (const res of set) res.write(": ping\n\n");
  }

  // Registers an authenticated connection. Throws RATE_LIMITED over the cap.
  async connect({ user_id, last_event_id, req, res }) {
    const existing = this.clients.get(user_id) ?? new Set();
    if (existing.size >= this.options.max_per_user) {
      throw new ApiError("RATE_LIMITED", "Too many open notification streams.", {
        headers: { "Retry-After": "30" },
      });
    }
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    existing.add(res);
    this.clients.set(user_id, existing);
    const close = () => {
      existing.delete(res);
      if (!existing.size) this.clients.delete(user_id);
    };
    req.on("close", close);
    res.on("close", close);

    if (last_event_id !== null && last_event_id !== undefined) {
      await this.replay(user_id, last_event_id, res);
    }
  }

  async replay(user_id, last_event_id, res) {
    const { replay_max } = this.options;
    const rows = await this.repository.fetch_for_user_after(user_id, last_event_id, replay_max + 1);
    if (rows.length > replay_max) {
      res.write("event: refetch\ndata: {}\n\n");
      return;
    }
    const unread = await this.repository.unread_count(user_id);
    for (const row of rows) {
      // Mark replayed rows delivered so the tail does not send them twice.
      this.remember(row.id);
      res.write(sse("notification", row.id, { notification: this.repository.to_dto(row), unread_count: unread }));
    }
  }
}

function sse(event, id, data) {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Last-Event-ID must be a non-negative safe integer; anything else is ignored.
function parse_last_event_id(value) {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

export { NotificationStreamHub, parse_last_event_id, sse };
