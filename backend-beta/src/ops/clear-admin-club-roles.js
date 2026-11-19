// One-off: removes club roles from venue administrators (rule: venue admins
// manage venues and events and hold no club role). Run before migration 020.
// Dry run by default; --apply changes the data in one transaction.
//   docker compose exec -T backend node src/ops/clear-admin-club-roles.js
//   docker compose exec -T backend node src/ops/clear-admin-club-roles.js --apply
// A venue admin who is a club president blocks it (exit code 1, no changes).
import { create_utc_pool } from "../db/pool.js";
import { clear_admin_club_roles } from "./admin_club_roles.js";

const pool = create_utc_pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
try {
  const result = await clear_admin_club_roles({ pool, apply: process.argv.includes("--apply") });
  if (result.blocked) process.exitCode = 1;
} catch (error) {
  console.error(`Clearing admin club roles failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
