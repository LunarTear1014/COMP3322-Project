// Google OIDC identity (ADR-0001). The sentinel value stored in
// password_hash for Google-only users: the scrypt hasher never emits it, so
// password verification against it always fails — hasher.verify() recognizes
// it and spends the dummy derivation so login timing does not reveal which
// accounts are Google-only. Ticket 03 writes it when provisioning a user from
// a Google sign-in; ticket 04's Profile Completion fills their student_id.

export const NO_PASSWORD_SENTINEL = "oauth$no-password";
