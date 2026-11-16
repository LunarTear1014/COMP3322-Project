// Operator command: give every club without a president a generated fictional
// president (and optionally a development venue administrator).
//   DEV_ACCOUNT_PASSWORD='<12+ chars>' node src/ops/provision-dev.js [--admin]
// Without DEV_ACCOUNT_PASSWORD a random password is generated and printed once.
import pool from "../config/db.js";
import { generated_password, provision_admin, provision_presidents } from "./dev_provisioning.js";

const supplied = process.env.DEV_ACCOUNT_PASSWORD;
if (supplied !== undefined && supplied.length < 12) {
  console.error("DEV_ACCOUNT_PASSWORD must be at least 12 characters.");
  process.exit(1);
}
const password = supplied ?? generated_password();
try {
  const created = await provision_presidents(pool, { password });
  console.log(created.length ? created.map((row) => `${row.club}: ${row.name} <${row.email}>`).join("\n") : "Every club already has a president.");
  if (process.argv.includes("--admin")) console.log(`Venue administrator: ${(await provision_admin(pool, { password })).email}`);
  if (supplied === undefined) console.log(`Generated password (shown once): ${password}`);
} finally {
  await pool.end();
}
