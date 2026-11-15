import { ApiError } from "../shared/errors.js";

// Shared transaction protocol (backend.md section 3).
//   acquire -> READ COMMITTED -> begin -> fn(connection) -> commit -> release
// Deadlock (1213) and lock-wait timeout (1205) roll back and re-run the whole
// callback at most twice, so the callback must re-read versions and
// permissions on every attempt. Connection loss or a failed COMMIT is never
// retried: the outcome is uncertain and the client must refetch.

const RETRYABLE = new Set([1213, 1205]);
// Jitter windows in milliseconds for retry 1 and retry 2.
const BACKOFF_MS = [[25, 100], [100, 250]];

// Global lock order: venue -> club -> booking -> event -> participation.
const LOCK_ORDER = ["venue", "club", "booking", "event", "participation"];

function is_retryable(error) {
  return RETRYABLE.has(error?.errno);
}

async function default_sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter([low, high], random) {
  return Math.round(low + random() * (high - low));
}

async function attempt(pool, fn) {
  const connection = await pool.getConnection();
  let began = false;
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    began = true;
    const result = await fn(connection);
    try {
      await connection.commit();
    } catch (error) {
      if (!is_retryable(error)) error.uncertain_commit = true;
      throw error;
    }
    began = false;
    return result;
  } catch (error) {
    if (began && !error.uncertain_commit) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error; a failed rollback must not mask it.
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function with_transaction(pool, fn, { sleep = default_sleep, random = Math.random } = {}) {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt(pool, fn);
    } catch (error) {
      if (!is_retryable(error)) throw error;
      if (tries >= BACKOFF_MS.length) {
        throw new ApiError("TRANSACTION_RETRY_EXHAUSTED", "The server is busy. Try again.");
      }
      await sleep(jitter(BACKOFF_MS[tries], random));
    }
  }
}

// Sorts lock requests into the global order, ascending id within a type, and
// removes duplicates. Services call this before acquiring row locks.
function ordered_locks(requests) {
  const seen = new Set();
  return requests
    .filter(({ type, id }) => {
      if (!LOCK_ORDER.includes(type)) throw new Error(`Unknown lock type: ${type}`);
      const key = `${type}:${id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => LOCK_ORDER.indexOf(a.type) - LOCK_ORDER.indexOf(b.type) || a.id - b.id);
}

export { BACKOFF_MS, LOCK_ORDER, is_retryable, ordered_locks, with_transaction };
