import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { create_app } from "../../app.js";
import { NotificationStreamHub } from "./stream_hub.js";
import { create_stream_router } from "./stream.routes.js";
import { to_dto } from "./notifications.repository.js";

// In-memory stand-in for the notifications table.
function fake_repository() {
  const rows = [];
  let next_id = 1;
  return {
    rows,
    add(user_id, title = "t") {
      const row = { id: next_id++, user_id, type: "event_published", title, body: "b", event_id: null,
        booking_id: null, created_at: "2026-11-12 02:00:00", read_at: null };
      rows.push(row);
      return row;
    },
    async max_id() { return rows.at(-1)?.id ?? 0; },
    async fetch_after(id, limit) { return rows.filter((row) => row.id > id).slice(0, limit); },
    async fetch_for_user_after(user_id, id, limit) {
      return rows.filter((row) => row.user_id === user_id && row.id > id).slice(0, limit);
    },
    async unread_count(user_id) { return rows.filter((row) => row.user_id === user_id && !row.read_at).length; },
    to_dto,
  };
}

let server;
let base;
let hub;
let repository;

before(async () => {
  repository = fake_repository();
  hub = new NotificationStreamHub({ repository, interval_ms: 40, heartbeat_ms: 60_000, max_per_user: 2, replay_max: 3, logger: { error() {} } });
  await hub.start();
  const authenticate = async (req) => Number(req.get("x-test-user")) || null;
  const app = create_app({
    session_secret: "x".repeat(32), app_origin: "http://app.test",
    v1_routers: [create_stream_router({ hub, authenticate })],
    logger: { error() {} },
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  hub.stop();
  server.closeAllConnections?.();
  server.close();
});

// Opens a stream and collects raw text; `until` resolves when a predicate holds.
function open_stream(user, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${base}/api/v1/notifications/stream`, { headers: { "x-test-user": String(user), ...headers } }, (response) => {
      const stream = { response, text: "", request, close: () => request.destroy() };
      response.setEncoding("utf8");
      response.on("data", (chunk) => { stream.text += chunk; });
      stream.until = (predicate, ms = 2000) => new Promise((ok, fail) => {
        const started = Date.now();
        const poll = setInterval(() => {
          if (predicate(stream.text)) { clearInterval(poll); ok(stream.text); }
          else if (Date.now() - started > ms) { clearInterval(poll); fail(new Error(`timeout; got: ${stream.text}`)); }
        }, 10);
      });
      resolve(stream);
    });
    request.on("error", reject);
  });
}

const events = (text) => [...text.matchAll(/id: (\d+)\nevent: notification\ndata: (.*)\n/g)]
  .map(([, id, data]) => ({ id: Number(id), ...JSON.parse(data) }));

describe("notification stream", () => {
  test("sends a heartbeat comment so proxies keep the stream open", async () => {
    const stream = await open_stream(61);
    hub.ping();
    await stream.until((t) => t.includes(": ping"));
    stream.close();
  });

  test("sets SSE headers", async () => {
    const stream = await open_stream(1);
    assert.match(stream.response.headers["content-type"], /^text\/event-stream/);
    assert.equal(stream.response.headers["x-accel-buffering"], "no");
    assert.match(stream.response.headers["cache-control"], /no-cache/);
    stream.close();
  });

  test("requires authentication", async () => {
    const response = await fetch(`${base}/api/v1/notifications/stream`);
    assert.equal(response.status, 401);
  });

  test("delivers a new row to its recipient in under 2 seconds, and only to them", async () => {
    const alice = await open_stream(11);
    const bob = await open_stream(12);
    const started = Date.now();
    repository.add(11, "for alice");
    const text = await alice.until((t) => events(t).length === 1);
    assert.ok(Date.now() - started < 2000);
    const [first] = events(text);
    assert.equal(first.notification.title, "for alice");
    assert.equal(first.unread_count >= 1, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(events(bob.text).length, 0, "other users never see it");
    alice.close();
    bob.close();
  });

  test("reconnect with Last-Event-ID replays the gap exactly once", async () => {
    const first = await open_stream(21);
    const a = repository.add(21, "a");
    await first.until((t) => events(t).some((e) => e.id === a.id));
    first.close();
    const b = repository.add(21, "b");
    const c = repository.add(21, "c");
    await new Promise((resolve) => setTimeout(resolve, 120)); // tail runs while disconnected
    const second = await open_stream(21, { "Last-Event-ID": String(a.id) });
    await second.until((t) => events(t).length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 200)); // give the tail a chance to double-send
    const ids = events(second.text).map((e) => e.id);
    assert.deepEqual(ids, [b.id, c.id], "no gap and no duplicate");
    second.close();
  });

  test("a gap larger than the replay limit asks the client to refetch", async () => {
    const ids = [1, 2, 3, 4].map(() => repository.add(31).id);
    const stream = await open_stream(31, { "Last-Event-ID": String(ids[0] - 1) });
    const text = await stream.until((t) => t.includes("event: refetch"));
    assert.equal(events(text).length, 0);
    stream.close();
  });

  test("caps connections per user", async () => {
    const one = await open_stream(41);
    const two = await open_stream(41);
    const third = await fetch(`${base}/api/v1/notifications/stream`, { headers: { "x-test-user": "41" } });
    assert.equal(third.status, 429);
    assert.equal(third.headers.get("retry-after"), "30");
    one.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const again = await open_stream(41);
    assert.equal(again.response.statusCode, 200);
    again.close();
    two.close();
  });

  test("a row that commits late with a lower id is still delivered", async () => {
    const stream = await open_stream(51);
    const late = repository.add(51, "late");
    const later = repository.add(52, "other");
    // Simulate out-of-order commit: the lower id becomes visible after a higher one was seen.
    repository.rows.splice(repository.rows.indexOf(late), 1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    repository.rows.splice(repository.rows.indexOf(later), 0, late);
    await stream.until((t) => events(t).some((e) => e.id === late.id));
    stream.close();
  });
});
