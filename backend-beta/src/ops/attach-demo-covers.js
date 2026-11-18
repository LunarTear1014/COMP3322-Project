// One-shot: gives the demo events their cover images (db/demo-images) on a
// database that was seeded before the images existed. Events that already
// have a cover are left alone, so it is safe to run again.
//   docker compose exec -T backend node src/ops/attach-demo-covers.js
import { assert_schema_version } from "../db/migrate.js";
import { create_utc_pool } from "../db/pool.js";
import { attach_demo_covers } from "./demo_covers.js";

const pool = create_utc_pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
try {
  await assert_schema_version(pool, "015_events_cover");
  await attach_demo_covers({ pool, cover_dir: process.env.COVER_DIR || "./data/covers" });
} catch (error) {
  console.error(`Demo covers failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
