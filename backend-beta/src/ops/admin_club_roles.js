// Venue administrators hold no club role. This finds the rows that break that
// rule and, with apply, removes them in one transaction: their memberships are
// deleted and their pending join requests are rejected. A venue admin who is a
// club's president blocks everything: nobody is chosen as successor here.
import { with_transaction } from "../db/transaction.js";

const MEMBERSHIPS = `SELECT u.id AS user_id, u.email, m.club_id, c.name AS club_name, m.role
  FROM memberships m JOIN users u ON u.id = m.user_id JOIN clubs c ON c.id = m.club_id
  WHERE u.platform_role = 'venue_admin' ORDER BY u.id, m.club_id`;
const REQUESTS = `SELECT r.id, u.id AS user_id, u.email, r.club_id, c.name AS club_name
  FROM club_join_requests r JOIN users u ON u.id = r.user_id JOIN clubs c ON c.id = r.club_id
  WHERE u.platform_role = 'venue_admin' AND r.status = 'pending' ORDER BY r.id`;

async function clear_admin_club_roles({ pool, apply = false, log = console.log, now = new Date() }) {
  const say = log || (() => {});
  const run = async (db) => {
    const [memberships] = await db.query(MEMBERSHIPS + (apply ? " FOR UPDATE" : ""));
    const [requests] = await db.query(REQUESTS + (apply ? " FOR UPDATE" : ""));
    const presidents = memberships.filter((row) => row.role === "president");
    if (presidents.length) {
      for (const row of presidents) say(`Blocked: ${row.email} (user ${row.user_id}) is president of ${row.club_name} (club ${row.club_id}). Give that club a new president first.`);
      return { blocked: true, presidents, memberships: memberships.length, requests: requests.length, applied: false };
    }
    for (const row of memberships) say(`${apply ? "Removing" : "Would remove"} ${row.role} membership: ${row.email} in ${row.club_name}`);
    for (const row of requests) say(`${apply ? "Rejecting" : "Would reject"} pending request: ${row.email} for ${row.club_name}`);
    if (!memberships.length && !requests.length) say("No venue administrator holds a club role. Nothing to do.");
    if (apply && (memberships.length || requests.length)) {
      await db.query("DELETE m FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.platform_role = 'venue_admin'");
      await db.query(
        `UPDATE club_join_requests r JOIN users u ON u.id = r.user_id
         SET r.status = 'rejected', r.reviewed_at = ? WHERE u.platform_role = 'venue_admin' AND r.status = 'pending'`, [now]);
    }
    return { blocked: false, presidents: [], memberships: memberships.length, requests: requests.length, applied: apply };
  };
  const result = apply ? await with_transaction(pool, run) : await run(pool);
  if (!apply && !result.blocked && (result.memberships || result.requests)) say("Dry run: nothing changed. Re-run with --apply to make these changes.");
  return result;
}

export { clear_admin_club_roles };
