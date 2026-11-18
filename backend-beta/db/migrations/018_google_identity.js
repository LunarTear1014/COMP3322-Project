// Google OIDC identity (ADR-0001 "Google OIDC via email-matched rows in the
// single users table"): users table gains a nullable google_sub (the IdP's
// stable OIDC Subject) with a unique index, and student_id relaxes to nullable
// so a Google-created user can exist before Profile Completion fills it in.
// MySQL UNIQUE indexes admit multiple NULLs, so password users with a
// student_id and Google users without one coexist.
//
// Additive only: password registration keeps requiring student_id at the API
// layer; only the DB constraint relaxes. The oauth$no-password sentinel lives
// in password_hash for Google-only users and is rejected explicitly at login.

export async function up(ctx) {
  await ctx.add_column("users", "google_sub", "VARCHAR(255) NULL");
  await ctx.add_index("users", "uk_users_google_sub", "google_sub", { unique: true });
  await ctx.query("ALTER TABLE `users` MODIFY `student_id` VARCHAR(50) NULL");
}
