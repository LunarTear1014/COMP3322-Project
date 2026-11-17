import express from "express";
import * as openid from "openid-client";
import { calculatePKCECodeChallenge, randomNonce, randomPKCECodeVerifier, randomState } from "openid-client";
import { ApiError } from "../shared/errors.js";
import { wrap } from "./common.js";
import { define_route } from "./router.js";

// Google OIDC sign-in (spec .scratch/google-oidc-login/spec.md, ADR-0001).
//
// create_google_router({ google_client, app_origin, ip_throttle }):
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
//
// Handshake values (state, nonce, PKCE verifier) are session-scoped and
// single-use; start regenerates the session first so an attacker-known
// session ID cannot be reused across a Google sign-in (session fixation).
// Ticket 03 provisions the user inside the callback; this ticket stops at a
// validated handshake.

const CALLBACK_PATH = "/api/auth/google/callback";
const ERROR_MARKER = "google_invalid_handshake";

function create_google_router({ google_client, app_origin, ip_throttle }) {
  const router = express.Router();
  const disabled = !google_client?.enabled || !app_origin;
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
      await regenerate(req);
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
      const current_url = new URL(req.originalUrl, "http://callback.invalid");
      const state_ok = handshake_present
        && typeof current_url.searchParams.get("code") === "string"
        && current_url.searchParams.get("state") === req.session.google_state;
      // Handshake values are single-use: cleared on success and failure alike.
      delete req.session.google_state;
      delete req.session.google_nonce;
      delete req.session.google_code_verifier;
      if (!state_ok) return res.redirect(`${app_origin}/?error=${ERROR_MARKER}`);
      // Handshake-only in this ticket: ticket 03 exchanges the code and
      // provisions the user here (regenerating the session again before it
      // sets user_id), then redirects to app_origin.
      res.redirect(app_origin);
    }),
  });

  return router;
}

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}

export { create_google_router, CALLBACK_PATH };
