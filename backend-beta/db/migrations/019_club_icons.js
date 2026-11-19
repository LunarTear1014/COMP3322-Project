// Club icon columns (club icons feature). Both nullable: a club without an
// icon renders its colour badge in the frontend. The key names the file in
// COVER_DIR (`<key>.icon.webp`); the timestamp feeds the DTO's cache-busting.

export async function up(ctx) {
  await ctx.add_column("clubs", "icon_key", "CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL");
  await ctx.add_column("clubs", "icon_updated_at", "DATETIME(6) NULL");
}
