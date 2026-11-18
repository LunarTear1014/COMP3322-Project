// Google OIDC client configuration (ticket 02, spec
// .scratch/google-oidc-login/spec.md, ADR-0001).
//
// create_google_client({ client_id, client_secret }) returns:
//   { enabled: false } when the credentials are missing (or only one is set,
//   with a warning) — the Google router then serves 404 for everything and
//   the app behaves exactly as without OAuth;
//   { enabled: true, get_config } otherwise. get_config() lazily performs
//   OpenID discovery against Google and caches the result; a transient
//   network failure clears the cache so a later request retries instead of
//   disabling Google sign-in until process restart. A failure surfaces to the
//   caller as a rejection, which the start route maps to a friendly redirect.

import { discovery } from "openid-client";

const GOOGLE_ISSUER = "https://accounts.google.com";

function create_google_client({ client_id, client_secret, logger = console } = {}) {
  if (!client_id || !client_secret) {
    if (client_id || client_secret) {
      logger.warn("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set; Google sign-in stays disabled.");
    }
    return { enabled: false, get_config: null };
  }
  let pending = null;
  const get_config = async () => {
    if (!pending) {
      // openid-client v6: the third argument is the client metadata; a bare
      // secret string resolves to { client_secret } and enables
      // client_secret_post authentication at the token endpoint. An object
      // with a camelCase `clientSecret` key would be silently ignored.
      pending = discovery(new URL(GOOGLE_ISSUER), client_id, client_secret)
        .catch((error) => {
          pending = null; // a later request retries discovery
          throw error;
        });
    }
    return pending;
  };
  return { enabled: true, get_config };
}

export { create_google_client, GOOGLE_ISSUER };
