// One-shot: gives the demo clubs their photos (db/demo-images/club-*.jpg) on a
// database that was seeded before club photos existed. Clubs that already have
// a photo are left alone, so it is safe to run again.
//   docker compose exec -T backend node src/ops/attach-demo-club-photos.js
import { assert_schema_version } from "../db/migrate.js";
import { create_utc_pool } from "../db/pool.js";
import { attach_demo_club_photos } from "./demo_club_photos.js";

const pool = create_utc_pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
try {
  await assert_schema_version(pool, "023_view_membership");
  await attach_demo_club_photos({ pool, cover_dir: process.env.COVER_DIR || "./data/covers" });
} catch (error) {
  console.error(`Demo club photos failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
