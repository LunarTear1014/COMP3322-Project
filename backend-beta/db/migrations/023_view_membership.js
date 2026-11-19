// Event page visits split by club membership. The views endpoint records the
// viewer's role in the event's club at the moment of the view, so the club
// activity report can tell members from non-members even after people join or
// leave. NULL means the row was recorded before this migration.

export async function up(ctx) {
  await ctx.add_column("event_views", "viewer_role", "ENUM('none','member','committee','president') NULL");
}
