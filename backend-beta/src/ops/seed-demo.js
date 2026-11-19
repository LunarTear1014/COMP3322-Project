// One-shot: fills an empty database with demo clubs, accounts and events,
// gives the events their cover images (demo_covers.js) and the clubs their icons
// (demo_club_icons.js) and photos (demo_club_photos.js).
//   DEMO_ACCOUNT_PASSWORD='<12+ chars>' node src/ops/seed-demo.js
// Compose runs it after the migrations on every `docker compose up`. It does
// nothing when DEMO_ACCOUNT_PASSWORD is unset or the database already has
// events, so it never touches real data. The one exception: on a database that
// already has events it still gives the five demo clubs (matched by name) an
// icon when they have none, so an existing deployment picks the icons up on the
// next `docker compose up`. It never replaces an icon or photo.
import { assert_schema_version } from "../db/migrate.js";
import { create_utc_pool } from "../db/pool.js";
import { seed_demo } from "./demo_seed.js";
import { attach_demo_covers } from "./demo_covers.js";
import { attach_demo_club_icons } from "./demo_club_icons.js";
import { attach_demo_club_photos } from "./demo_club_photos.js";

const password = process.env.DEMO_ACCOUNT_PASSWORD ?? "";
if (!password) {
  console.log("DEMO_ACCOUNT_PASSWORD is not set; skipping demo data.");
  process.exit(0);
}
if (password.length < 12) {
  console.error("DEMO_ACCOUNT_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const pool = create_utc_pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, connection_limit: 8,
});
const cover_dir = process.env.COVER_DIR || "./data/covers";
try {
  await assert_schema_version(pool, "021_club_photos");
  const result = await seed_demo({ pool, password });
  if (result.skipped) {
    console.log(`Skipping demo data: ${result.skipped}`);
  } else {
    console.log("Demo accounts (password: DEMO_ACCOUNT_PASSWORD; Compose defaults it to clubspacetest123):");
    for (const account of result.accounts) {
      const role = account.platform_role === "venue_admin" ? "venue administrator" : account.club ? `${account.role}, ${account.club}` : "student, no club";
      console.log(`  ${account.email.padEnd(40)} ${account.name} (${role})`);
    }
    await attach_demo_covers({ pool, cover_dir });
  }
  await attach_demo_club_icons({ pool, cover_dir });
  await attach_demo_club_photos({ pool, cover_dir });
} catch (error) {
  console.error(`Demo data failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
