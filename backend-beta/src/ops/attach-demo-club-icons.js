// One-shot: gives the demo clubs their icons (db/demo-icons) on a
// database that was seeded before club icons existed. Clubs that already have
// an icon are left alone, so it is safe to run again.
//   docker compose exec -T backend node src/ops/attach-demo-club-icons.js
import { assert_schema_version } from "../db/migrate.js";
import { create_utc_pool } from "../db/pool.js";
import { attach_demo_club_icons } from "./demo_club_icons.js";

const pool = create_utc_pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
try {
  await assert_schema_version(pool, "019_club_icons");
  await attach_demo_club_icons({ pool, cover_dir: process.env.COVER_DIR || "./data/covers" });
} catch (error) {
  console.error(`Demo club icons failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
