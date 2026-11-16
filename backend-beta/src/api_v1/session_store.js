import session from "express-session";

// express-session store on the migration-created `sessions` table (binary
// collation keeps session IDs case-sensitive). 8 hour rolling idle expiry;
// expired rows are removed every 15 minutes.
const DAY_SECONDS = 24 * 3600;

class MysqlSessionStore extends session.Store {
  constructor({ pool, ttl_seconds = 8 * 3600, cleanup_ms = 15 * 60_000 }) {
    super();
    this.pool = pool;
    this.ttl = ttl_seconds;
    this.timer = cleanup_ms ? setInterval(() => this.cleanup().catch(() => {}), cleanup_ms) : null;
    this.timer?.unref();
  }

  expiry(sess) {
    const cookie = sess?.cookie?.expires ? Math.floor(new Date(sess.cookie.expires).getTime() / 1000) : 0;
    return Math.max(cookie, Math.floor(Date.now() / 1000) + this.ttl);
  }

  get(sid, callback) {
    this.pool.query("SELECT data FROM sessions WHERE session_id = ? AND expires > ?", [sid, Math.floor(Date.now() / 1000)])
      .then(([rows]) => callback(null, rows[0] ? JSON.parse(rows[0].data) : null), callback);
  }

  set(sid, sess, callback) {
    this.pool.query(
      `INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sid, this.expiry(sess), JSON.stringify(sess)],
    ).then(() => callback?.(null), (error) => callback?.(error));
  }

  touch(sid, sess, callback) {
    this.pool.query("UPDATE sessions SET expires = ? WHERE session_id = ?", [this.expiry(sess), sid])
      .then(() => callback?.(null), (error) => callback?.(error));
  }

  destroy(sid, callback) {
    this.pool.query("DELETE FROM sessions WHERE session_id = ?", [sid])
      .then(() => callback?.(null), (error) => callback?.(error));
  }

  async cleanup() {
    await this.pool.query("DELETE FROM sessions WHERE expires <= ?", [Math.floor(Date.now() / 1000)]);
  }

  close() { clearInterval(this.timer); }
}

export { DAY_SECONDS, MysqlSessionStore };
