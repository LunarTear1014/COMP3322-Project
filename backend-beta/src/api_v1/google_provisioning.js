import { NO_PASSWORD_SENTINEL } from "./identity.js";
import { with_transaction } from "../db/transaction.js";

// Google OIDC provisioning (ticket 03, ADR-0001): resolve a validated ID
// token's claims to a single users-table row inside one transaction.
//
//   1. `google_sub` match signs the user in — the Subject always wins over
//      email, so a Google-side email change cannot hijack or fork an account.
//   2. Otherwise the email is only trusted when Google reports it verified
//      (email_verified): an exact match links the existing password account
//      by setting google_sub — its password, roles and memberships survive.
//      Email is compared like login does (LOWER(TRIM)) so legacy rows with
//      padded or mixed-case addresses still link instead of colliding.
//   3. Otherwise a new row is created: sentinel password (the scrypt hasher
//      never emits it, so password login stays impossible), null student_id
//      (Profile Completion, ticket 04, fills it) and platform_role 'student'.
//
// Races surface as GoogleProvisionRaceError (a concurrent request won the
// unique email or google_sub slot) and GoogleSubAlreadyLinkedError (the
// matched row belongs to a different Google account) — the caller turns both
// into a friendly redirect, never a 500. UnverifiedEmailError means no account
// was touched.

class GoogleProvisionRaceError extends Error {
  constructor() {
    super("A concurrent sign-in claimed this account's email or Google Subject.");
    this.name = "GoogleProvisionRaceError";
  }
}

class GoogleEmailUnverifiedError extends Error {
  constructor() {
    super("Google did not report the account's email as verified.");
    this.name = "GoogleEmailUnverifiedError";
  }
}

class GoogleSubAlreadyLinkedError extends Error {
  constructor() {
    super("That verified email already belongs to a different Google account.");
    this.name = "GoogleSubAlreadyLinkedError";
  }
}

// The unique-index violation a concurrent winner produces (link UPDATE or
// user INSERT); anything else propagates.
function as_race(error) {
  if (error?.code === "ER_DUP_ENTRY") throw new GoogleProvisionRaceError();
  throw error;
}

// `claims` is the validated ID token payload: { sub, email, email_verified,
// name }. Returns the signed-in user's id.
async function provision_google_user(pool, claims) {
  const { sub, email, email_verified, name } = claims;
  return with_transaction(pool, async (conn) => {
    const [[by_sub]] = await conn.query("SELECT id FROM users WHERE google_sub = ? LIMIT 1", [sub]);
    if (by_sub) return by_sub.id;
    if (!email_verified) throw new GoogleEmailUnverifiedError();

    const [[by_email]] = await conn.query("SELECT id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1", [email]);
    if (by_email) {
      // First link wins: a row already carrying a different google_sub stays
      // with that account (a second Google identity shares the email only if
      // Google let it — that is a support matter, not a silent takeover).
      const [[owned]] = await conn.query("SELECT google_sub FROM users WHERE id = ? LIMIT 1", [by_email.id]);
      if (owned.google_sub != null) {
        if (owned.google_sub === sub) return by_email.id; // idempotent re-link
        throw new GoogleSubAlreadyLinkedError();
      }
      await conn.query("UPDATE users SET google_sub = ? WHERE id = ?", [sub, by_email.id]).catch(as_race);
      return by_email.id;
    }

    try {
      const [result] = await conn.query(
        "INSERT INTO users (email, password_hash, name, student_id, platform_role, google_sub) VALUES (?, ?, ?, NULL, 'student', ?)",
        [email, NO_PASSWORD_SENTINEL, name, sub]);
      return result.insertId;
    } catch (error) {
      as_race(error);
    }
  });
}

export { provision_google_user, GoogleProvisionRaceError, GoogleEmailUnverifiedError, GoogleSubAlreadyLinkedError };
