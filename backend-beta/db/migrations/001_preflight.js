// Tracking exists in the runner; this step refuses to continue on a legacy
// database whose rows would violate the workflow invariants.
import { MigrationError } from "../../src/db/migrate.js";
import { format_report, run_preflight } from "../../src/db/preflight.js";

export async function up(ctx) {
  const [engine] = await ctx.query(
    "SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events'", [ctx.database]);
  if (!engine || engine.engine !== "InnoDB") {
    throw new MigrationError("PREFLIGHT_FAILED", "Expected the beta baseline (InnoDB events table).");
  }
  const problems = await run_preflight((sql) => ctx.query(sql));
  if (problems.length) {
    throw new MigrationError("PREFLIGHT_FAILED", `Repair these before migrating: ${format_report(problems)}`);
  }
}
