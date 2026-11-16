// Dev helper: boots the real API (src/index.js) on the disposable test database
// with demo data, so the frontend can be tried against the v1 provider.
//   TEST_ENV_FILE=/path/to/test.env node scripts/serve-dev-db.mjs
// Demo password for every account: dev-password-123. Never run this against a real database.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prepare_database } from "../test/db_helper.js";
import { provision_admin, provision_presidents } from "../src/ops/dev_provisioning.js";
import { create_password_hasher } from "../src/features/users/password_hasher.js";

const db = await prepare_database();
Object.assign(process.env, {
  DB_HOST: db.config.host, DB_PORT: String(db.config.port), DB_USER: db.config.user, DB_PASSWORD: db.config.password, DB_NAME: db.config.database,
  APP_ORIGIN: process.env.APP_ORIGIN || "http://127.0.0.1:5199", PORT: process.env.PORT || "3300", NODE_ENV: "development", SESSION_SECRET: "x".repeat(40),
  COVER_DIR: process.env.COVER_DIR || "/tmp/clubspace-serve-covers",
});
await db.admin.query(readFileSync(fileURLToPath(new URL("../db/deployment-seed.sql", import.meta.url)), "utf8"));
const hasher = create_password_hasher();
const hash = await hasher.hash("dev-password-123");
await db.admin.query("INSERT INTO users (email, password_hash, name, student_id) VALUES ('student@clubspace.example', ?, 'Sam Tsang', 'STU-001'), ('committee@clubspace.example', ?, 'Mei Lau', 'COM-001')", [hash, hash]);
await db.admin.query("INSERT INTO memberships (user_id, club_id, role) SELECT u.id, 1, 'committee' FROM users u WHERE u.email = 'committee@clubspace.example'");
await provision_presidents(db.pool, { password: "dev-password-123", hasher });
await provision_admin(db.pool, { password: "dev-password-123", hasher });
console.log("Demo accounts (password dev-password-123): student@, committee@, president.club1@, admin@ at clubspace.example");
await import("../src/index.js");
