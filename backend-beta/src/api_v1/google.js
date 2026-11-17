import express from "express";
import * as openid from "openid-client";
import { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState } from "openid-client";
import { rotate_csrf_token } from "../middleware/csrf.js";
import { provision_google_user, GoogleEmailUnverifiedError, GoogleProvisionRaceError, GoogleSubAlreadyLinkedError } from "./google_provisioning.js";
import { ApiError } from "../shared/errors.js";
import { session_regenerate, session_save, wrap } from "./common.js";
import { define_route } from "./router.js";

// Google OIDC sign-in (spec .scratch/google-oidc-login/spec.md, ADR-0001).
//
// create_google_router({ google_client, app_origin, ip_throttle, pool }):
//   google_client: the object from create_google_client (google_setup.js) —
//     { enabled: false } mounts nothing but a 404; { enabled: true,
//     get_config } lazily discovers Google and caches the Configuration.
//   app_origin: the browser-facing origin; the redirect_uri registered in the
//     Google Cloud Console is ${app_origin}/api/auth/google/callback — the
//     frontend origin with /api proxied to the backend (Vite in dev, nginx in
//     prod). This router is mounted under /api/v1, and index.js additionally
//     mounts the same router at the frontend-facing /api/auth prefix so
//     Google's redirect lands here (see index.js mount_google_callback).
//   ip_throttle: shared IP throttle from the v1 stack.
//   pool: v1 pool; the callback provisions the user through it (ticket 03).
//
// Handshake values (state, nonce, PKCE verifier) are session-scoped and
// single-use; start regenerates the session first so an attacker-known
// session ID cannot be reused across a Google sign-in (session fixation).
// The callback exchanges the code (state + nonce + PKCE verified by
// openid-client), provisions the user (google_sub match -> verified-email
// link -> create) inside one transaction, then mirrors password login:
// regenerate, set user_id, rotate CSRF, save, redirect home. Every failure —
// handshake, exchange, unverified email, race — is a friendly error-marker
// redirect to the app, never a stack trace.

const CALLBACK_PATH = "/api/auth/google/callback";
const ERROR_MARKER = "google_invalid_handshake";
const UNVERIFIED_MARKER = "google_email_unverified";
const RACE_MARKER = "google_sign_in_busy";
const LINKED_MARKER = "google_email_linked_elsewhere";
const UNAVAILABLE_MARKER = "google_unavailable";

function create_google_router({ google_client, app_origin, ip_throttle, pool }) {
  const router = express.Router();
  const disabled = !google_client?.enabled || !app_origin || !pool;
  const redirect_uri = app_origin ? `${app_origin.replace(/\/$/, "")}${CALLBACK_PATH}` : CALLBACK_PATH;
  const ip_of = (req) => req.ip || req.socket?.remoteAddress || "unknown";

  if (disabled) {
    // No credentials configured: the two Google routes are 404, scoped to
    // those paths only — this router sits in the middle of the v1 chain, so
    // an unscoped router.use would 404 every later router too.
    for (const path of ["/google/start", "/google/callback"]) {
      define_route(router, path, {
        get: (_req, _res, next) => next(new ApiError("NOT_FOUND", "That resource does not exist.")),
      });
    }
    // Read by the v1 stack: the public config endpoint reports whether the
    // routes exist, so the frontend can hide the sign-in button.
    router.__google_disabled = true;
    return router;
  }

  const { get_config } = google_client;

  define_route(router, "/google/start", {
    get: wrap(async (req, res) => {
      if (ip_throttle) ip_throttle.hit(`google-start:${ip_of(req)}`);
      let config;
      try {
        config = await get_config();
      } catch {
        // Transient discovery failure: treat like any other IdP-side problem.
        return res.redirect(`${app_origin}/?error=google_unavailable`);
      }
      // Regenerate before writing handshake values so an attacker-known
      // session ID does not survive into the sign-in (session fixation).
      await session_regenerate(req);
      const state = randomState();
      const nonce = randomNonce();
      const verifier = randomPKCECodeVerifier();
      const challenge = await calculatePKCECodeChallenge(verifier);
      req.session.google_state = state;
      req.session.google_nonce = nonce;
      req.session.google_code_verifier = verifier;
      const authorization_url = openid.buildAuthorizationUrl(config, {
        redirect_uri,
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      res.redirect(authorization_url.href);
    }),
  });

  define_route(router, "/google/callback", {
    get: wrap(async (req, res) => {
      const handshake_present = typeof req.session.google_state === "string" && typeof req.session.google_code_verifier === "string";
      // Reconstruct the callback URL with its registered origin so the grant
      // sends the exact redirect_uri the code was issued for (the backend
      // serves /api/auth under the frontend's origin in dev and prod alike).
      const current_url = new URL(req.originalUrl, app_origin);
      const expected_state = req.session.google_state;
      const expected_nonce = req.session.google_nonce;
      const verifier = req.session.google_code_verifier;
      const state_ok = handshake_present
        && typeof current_url.searchParams.get("code") === "string"
        && current_url.searchParams.get("state") === expected_state;
      // Handshake values are single-use: cleared on success and failure alike.
      delete req.session.google_state;
      delete req.session.google_nonce;
      delete req.session.google_code_verifier;
      if (!state_ok) return res.redirect(`${app_origin}/?error=${ERROR_MARKER}`);

      let user_id;
      try {
        // openid-client verifies the state echo, the nonce in the ID token and
        // the PKCE verifier against the token endpoint's response.
        const config = await get_config();
        const tokens = await openid.authorizationCodeGrant(config, current_url, {
          expectedState: expected_state,
          expectedNonce: expected_nonce,
          pkceCodeVerifier: verifier,
        });
        const claims = tokens.claims();
        if (!claims?.sub) throw new Error("ID token carried no subject");
        user_id = await provision_google_user(pool, {
          sub: claims.sub,
          email: claims.email,
          email_verified: claims.email_verified === true,
          name: claims.name,
        });
      } catch (error) {
        if (error instanceof GoogleEmailUnverifiedError) {
          return res.redirect(`${app_origin}/?error=${UNVERIFIED_MARKER}`);
        }
        if (error instanceof GoogleProvisionRaceError) {
          return res.redirect(`${app_origin}/?error=${RACE_MARKER}`);
        }
        if (error instanceof GoogleSubAlreadyLinkedError) {
          return res.redirect(`${app_origin}/?error=${LINKED_MARKER}`);
        }
        // Discovery failure, token-endpoint rejection, malformed ID token,
        // database trouble: all get the same friendly redirect, no stack.
        return res.redirect(`${app_origin}/?error=${UNAVAILABLE_MARKER}`);
      }

      // Session handling mirrors password login exactly (auth.js): a fresh
      // session ID so a pre-sign-in session cannot be reused, user_id on the
      // session, a rotated CSRF token, then an explicit save before redirect.
      await session_regenerate(req);
      req.session.user_id = user_id;
      rotate_csrf_token(req);
      await session_save(req);
      res.redirect(`${app_origin}/`);
    }),
  });

  return router;
}

export { create_google_router, CALLBACK_PATH };
