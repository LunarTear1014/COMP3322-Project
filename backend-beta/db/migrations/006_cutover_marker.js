// Records the schema version the API and worker require at startup.
export const REQUIRED_SCHEMA = "015_events_cover";

export async function up(ctx) {
  await ctx.query(`INSERT INTO schema_metadata (metadata_key, metadata_value) VALUES ('schema_version', ?)
    ON DUPLICATE KEY UPDATE metadata_value = VALUES(metadata_value)`, ["workflow-v1"]);
}
