// Club photo columns (club photos feature). All nullable: a club without a
// photo shows its colour pattern in the frontend. The key names the two files
// in COVER_DIR (`<key>.photo.card.webp` and `<key>.photo.full.webp`); the
// timestamp feeds the DTO's cache-busting.

export async function up(ctx) {
  await ctx.add_column("clubs", "photo_key", "CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL");
  await ctx.add_column("clubs", "photo_alt", "VARCHAR(200) NULL");
  await ctx.add_column("clubs", "photo_updated_at", "DATETIME(6) NULL");
}
