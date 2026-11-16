// A small world for v1 DB tests: two clubs, two venues, an admin, a president,
// committee, members and students.
async function build_world(app) {
  const { admin } = app;
  await admin.query(`INSERT INTO clubs (id, name) VALUES (1, 'Photo'), (2, 'Film');
    INSERT INTO venues (id, name, location, capacity, is_active) VALUES (1, 'Hall', 'L2', 40, 1), (2, 'Studio', 'L3', 10, 1), (3, 'Closed', 'L4', 10, 0);`);
  const ids = {};
  for (const [key, platform_role] of [["admin", "venue_admin"], ["pres", "student"], ["comm", "student"], ["pres2", "student"], ["mem", "student"], ["s1", "student"], ["s2", "student"], ["s3", "student"], ["s4", "student"], ["admin_c", "venue_admin"]]) {
    ids[key] = await app.user({ email: `${key}@x.test`, name: key, student_id: key, platform_role });
  }
  await admin.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, 1, 'president'), (?, 1, 'committee'), (?, 1, 'member'), (?, 2, 'president'), (?, 1, 'committee')",
    [ids.pres, ids.comm, ids.mem, ids.pres2, ids.admin_c]);
  return ids;
}

// A future Hong Kong date string `days` from the harness clock.
function future_date(app, days) {
  const date = new Date(app.get_now().getTime() + days * 86_400_000 + 8 * 3_600_000);
  return date.toISOString().slice(0, 10);
}

const create_body = (app, over = {}) => ({
  club_id: 1, venue_id: 1, title: "Photo walk", description: "Walk and shoot.", date: future_date(app, 5), slot_id: "morning",
  visibility: "public", capacity: 2, ...over,
});

// Creates an event as the president, approves the booking as admin, publishes it.
async function published_event(app, ids, over = {}) {
  const pres = await app.client_for("pres@x.test");
  const admin = await app.client_for("admin@x.test");
  const created = await pres.post("/events", create_body(app, over));
  if (created.status !== 201) throw new Error(`create failed ${JSON.stringify(created.body)}`);
  const event = created.body.data;
  const approved = await admin.post(`/bookings/${event.booking.id}/decision`, { expected_version: event.booking.version, decision: "approve" });
  if (approved.status !== 200) throw new Error(`approve failed ${JSON.stringify(approved.body)}`);
  const published = await pres.post(`/events/${event.id}/publish`, { expected_version: event.version });
  if (published.status !== 200) throw new Error(`publish failed ${JSON.stringify(published.body)}`);
  return published.body.data;
}

export { build_world, create_body, future_date, published_event };
