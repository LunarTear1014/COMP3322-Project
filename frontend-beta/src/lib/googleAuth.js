// Friendly sentences for the backend's Google callback error markers
// (?error=<marker>, see backend-beta/src/api_v1/google.js): one per marker,
// a generic fallback for anything unrecognized.
export const GOOGLE_ERRORS = {
  google_invalid_handshake: 'Your Google sign-in session expired or was already used. Start again from the sign-in page.',
  google_email_unverified: 'Your Google account has no verified email address, so ClubSpace cannot link it. Verify the email with Google and try again.',
  google_sign_in_busy: 'Another sign-in just touched your account. Wait a moment and try again.',
  google_email_linked_elsewhere: 'This Google account is already linked to a different ClubSpace account. Sign in with that account’s password instead.',
  google_unavailable: 'Google sign-in is not available right now. Please try again shortly, or use your email and password.',
}
export const GOOGLE_ERROR_FALLBACK = 'Google sign-in failed. Please try again, or use your email and password.'
