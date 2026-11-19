
const asDate = (text) => new Date(`${String(text).replace(" ", "T")}Z`);
const round3 = (n) => Math.round(n * 1000) / 1000;
const rate = (num, den) => (den > 0 ? round3(num / den) : null);

function visit_row(people) {
  const members = people.filter((p) => p.member);
  const others = people.filter((p) => !p.member);
  const joined = (list) => list.filter((p) => p.clicked_join).length;
  const [visitors, member_visitors, non_member_visitors] = [people.length, members.length, others.length];
  const [clicked_join, member_clicked_join, non_member_clicked_join] = [joined(people), joined(members), joined(others)];
  return {
    visitors, member_visitors, non_member_visitors,
    clicked_join, member_clicked_join, non_member_clicked_join,
    join_rate: rate(clicked_join, visitors), member_join_rate: rate(member_clicked_join, member_visitors),
    non_member_join_rate: rate(non_member_clicked_join, non_member_visitors),
  };
}

// Event page visits for the club activity report: aggregated counts only.
//
// A visitor is a distinct user with at least one event_views row for the event
// (all views of the event, whenever they happened; the report window only
// chooses the events). Each person is classified once, from their earliest view:
//   - recorded viewer_role 'member' / 'none' -> member / non-member;
//   - 'committee' / 'president' -> the club's own committee, excluded;
//   - NULL (recorded before migration 023) -> current memberships: committee or
//     president is excluded, a member whose joined_at is at or before the first
//     view is a member, anyone else a non-member (so members removed since count as non-members).
// Venue administrators are always excluded.
// "Clicked Join" = after the first view the person has a 'joined' or 'waitlisted'
// participation_history action, or an event_join_requests row requested at/after it.
async function build_event_visits(pool, club_id, event_ids) {
  if (!event_ids.length) return { rows: [], totals: visit_row([]) };
  const [views] = await pool.query(
    `SELECT v.event_id, v.user_id, v.viewed_at, v.viewer_role, u.platform_role
     FROM event_views v JOIN users u ON u.id = v.user_id
     WHERE v.event_id IN (?) ORDER BY v.viewed_at, v.id`, [event_ids]);
  const [memberships] = await pool.query("SELECT user_id, role, joined_at FROM memberships WHERE club_id = ?", [club_id]);
  const [history] = await pool.query(
    "SELECT event_id, user_id, occurred_at FROM participation_history WHERE event_id IN (?) AND action IN ('joined', 'waitlisted')", [event_ids]);
  const [requests] = await pool.query("SELECT event_id, user_id, requested_at FROM event_join_requests WHERE event_id IN (?)", [event_ids]);

  const member_of = new Map(memberships.map((row) => [row.user_id, row]));
  const first = new Map();
  for (const row of views) {
    const key = `${row.event_id}:${row.user_id}`;
    if (!first.has(key)) first.set(key, row);
  }
  const registered = new Map();
  for (const [rows, column] of [[history, "occurred_at"], [requests, "requested_at"]]) {
    for (const row of rows) {
      const key = `${row.event_id}:${row.user_id}`;
      const at = asDate(row[column]);
      // Keep the latest: someone who joined before opening the page, left, and
      // joined again after opening it did click Join after their first view.
      const seen = registered.get(key);
      if (!seen || at > seen) registered.set(key, at);
    }
  }

  const people = new Map(event_ids.map((id) => [id, []]));
  for (const [key, row] of first) {
    if (row.platform_role === "venue_admin") continue;
    const seen = asDate(row.viewed_at);
    const current = member_of.get(row.user_id);
    let member;
    if (row.viewer_role === "committee" || row.viewer_role === "president") continue;
    if (row.viewer_role === "member") member = true;
    else if (row.viewer_role === "none") member = false;
    else {
      if (current && current.role !== "member") continue;
      member = Boolean(current) && asDate(current.joined_at) <= seen;
    }
    const latest_registration = registered.get(key);
    people.get(row.event_id).push({ member, clicked_join: Boolean(latest_registration) && latest_registration >= seen });
  }
  const rows = event_ids.map((event_id) => ({ event_id, ...visit_row(people.get(event_id)) }));
  const all = [...people.values()].flat();
  return { rows, totals: visit_row(all) };
}

// The viewer's role in the club at view time, stored with the view.
async function viewer_role_in(pool, user_id, club_id) {
  const [[row]] = await pool.query("SELECT role FROM memberships WHERE user_id = ? AND club_id = ?", [user_id, club_id]);
  return row?.role ?? "none";
}

export { build_event_visits, viewer_role_in };
