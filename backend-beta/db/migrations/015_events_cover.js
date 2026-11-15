// Event cover columns (change refresh-clubspace-visual-design, task 5.1).
// All nullable: events without a cover render the fallback in the frontend.

export async function up(ctx) {
  await ctx.add_column("events", "cover_key", "CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL");
  await ctx.add_column("events", "cover_alt", "VARCHAR(200) NULL");
  await ctx.add_column("events", "cover_updated_at", "DATETIME(6) NULL");
}
