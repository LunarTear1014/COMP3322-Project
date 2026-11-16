import { cover_dto } from "../features/covers/cover_service.js";
import { iso, to_db } from "./common.js";

// Event reads shared by the routes: one SQL shape, DTO mapping and the
// eligibility rules (api.md section 6). Counts and my_registration are
// advisory snapshots; every write rechecks under locks.

const WAITING = "('waitlisted', 'pending')";
const LEFT = ["left", "unsuccessful"];
const QUEUE_LIMIT = 500;

const normalize_status = (status) => (status === "pending" ? "waitlisted" : LEFT.includes(status) ? "left" : status);

// Rows for events with club, venue, booking, counts and the viewer's state.
async function event_rows(db, { viewer_id, where = "1 = 1", params = [], order = "e.start_time ASC, e.id ASC", limit = null, offset = 0 }) {
  const [rows] = await db.query(
    `SELECT e.id, e.club_id, e.title, e.description, e.start_time, e.end_time, e.registration_closes_at, e.visibility, e.status,
            e.version, e.capacity, e.cover_key, e.cover_alt, e.cover_updated_at, e.signoff_requested_by, e.signoff_reason,
            e.checkin_code, e.checkin_opened_at, c.name AS club_name,
            v.id AS venue_id, v.name AS venue_name, v.capacity AS venue_capacity, v.location AS venue_location,
            b.id AS b_id, b.status AS b_status, b.version AS b_version, b.decision_reason AS b_reason, b.decided_at AS b_decided_at,
            b.signoff_requested_by AS b_signoff_by, b.signoff_reason AS b_signoff_reason,
            (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.status = 'joined') AS joined_count,
            (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.status IN ${WAITING}) AS waitlisted_count,
            mine.status AS my_status,
            (SELECT COUNT(*) FROM participations q WHERE q.event_id = e.id AND q.status IN ${WAITING}
               AND (q.queued_at < mine.queued_at OR (q.queued_at = mine.queued_at AND q.user_id <= mine.user_id))) AS my_position,
            mem.role AS my_role,
            (SELECT r.status FROM event_join_requests r WHERE r.event_id = e.id AND r.user_id = ?) AS my_request,
            (SELECT COUNT(*) FROM event_join_requests r WHERE r.event_id = e.id AND r.status = 'pending') AS pending_requests
     FROM events e
     JOIN clubs c ON c.id = e.club_id
     JOIN bookings b ON b.id = e.booking_id
     JOIN venues v ON v.id = b.venue_id
     LEFT JOIN participations mine ON mine.event_id = e.id AND mine.user_id = ?
     LEFT JOIN memberships mem ON mem.club_id = e.club_id AND mem.user_id = ?
     WHERE ${where}
     ORDER BY ${order}${limit ? " LIMIT ? OFFSET ?" : ""}`,
    [viewer_id, viewer_id, viewer_id, ...params, ...(limit ? [limit, offset] : [])]);
  return rows;
}

async function tags_for(db, ids) {
  const map = new Map(ids.map((id) => [id, { campus: [], club: [] }]));
  if (!ids.length) return map;
  const [campus] = await db.query(
    "SELECT ect.event_id, t.id, t.slug, t.name FROM event_campus_tags ect JOIN campus_tags t ON t.id = ect.campus_tag_id WHERE ect.event_id IN (?) ORDER BY t.name", [ids]);
  for (const row of campus) map.get(row.event_id).campus.push({ id: row.id, slug: row.slug, name: row.name });
  const [club] = await db.query(
    "SELECT ect.event_id, t.id, t.name FROM event_club_tags ect JOIN club_tags t ON t.id = ect.club_tag_id WHERE ect.event_id IN (?) ORDER BY t.name_key", [ids]);
  for (const row of club) map.get(row.event_id).club.push({ id: row.id, name: row.name });
  return map;
}

// Members-only events need committee approval for plain members; the club's
// committee and president register directly (event-participation spec).
const needs_approval = (visibility, role) => visibility === "members_only" && role === "member";

// The viewer's registration: a pending request shows as "requested" until
// the committee decides; joined or waitlisted always wins.
function registration_status(row) {
  const status = normalize_status(row.my_status ?? "none");
  if (!["joined", "waitlisted"].includes(status) && row.my_request === "pending") return "requested";
  return status;
}

function eligibility(row, now) {
  const status = registration_status(row);
  const joined = Number(row.joined_count);
  const waiting = Number(row.waitlisted_count);
  const requires_approval = needs_approval(row.visibility, row.my_role);
  const no = (reason) => ({ can_register: false, can_waitlist: false, requires_approval, reason });
  if (row.status === "cancelled") return no("EVENT_CANCELLED");
  if (row.status !== "published" || row.b_status !== "confirmed") return no("NOT_PUBLISHED");
  if (["joined", "waitlisted"].includes(status)) return no("ALREADY_REGISTERED");
  if (status === "requested") return no("REQUEST_PENDING");
  if (new Date(`${row.registration_closes_at.replace(" ", "T")}Z`) <= now || new Date(`${row.start_time.replace(" ", "T")}Z`) <= now) return no("REGISTRATION_CLOSED");
  if (row.visibility === "members_only" && !row.my_role) return no("MEMBERSHIP_REQUIRED");
  if (joined < Number(row.capacity)) return { can_register: true, can_waitlist: false, requires_approval, reason: null };
  if (waiting < QUEUE_LIMIT) return { can_register: false, can_waitlist: true, requires_approval, reason: "EVENT_FULL" };
  return no("WAITLIST_FULL");
}

// Event (detail) or EventSummary shape. `viewer_manages` adds booking detail.
function event_dto(row, tags, now, { detail = true, manages = false } = {}) {
  const status = registration_status(row);
  const start = new Date(`${row.start_time.replace(" ", "T")}Z`);
  const dto = {
    id: row.id,
    club: { id: row.club_id, name: row.club_name },
    venue: { id: row.venue_id, name: row.venue_name, capacity: row.venue_capacity },
    title: row.title,
    start_at: iso(row.start_time),
    end_at: iso(row.end_time),
    registration_closes_at: iso(row.registration_closes_at),
    visibility: row.visibility,
    state: row.status,
    phase: start >= now ? "upcoming" : "past",
    version: Number(row.version),
    capacity: Number(row.capacity),
    joined_count: Number(row.joined_count),
    waitlisted_count: Number(row.waitlisted_count),
    my_registration: { status, queue_position: status === "waitlisted" ? Number(row.my_position) : null },
    eligibility: eligibility(row, now),
    cover: cover_dto(row.id, row),
    campus_tags: tags?.campus ?? [],
    club_tags: tags?.club ?? [],
    signoff: row.signoff_requested_by || row.b_signoff_by
      ? { requested_by: row.signoff_requested_by ?? row.b_signoff_by, reason: row.signoff_reason ?? row.b_signoff_reason ?? null } : null,
  };
  if (manages) dto.pending_join_requests = Number(row.pending_requests ?? 0);
  if (detail) {
    dto.description = row.description;
    dto.booking = {
      id: row.b_id, status: row.b_status, version: Number(row.b_version),
      expired: row.b_status === "pending" && start <= now,
      decision_reason: manages ? row.b_reason : null, decided_at: manages ? iso(row.b_decided_at) : null,
    };
  }
  return dto;
}

// Who may see this event? Returns { visible, manages }.
function access(row, user, now) {
  const manages = ["committee", "president"].includes(row.my_role) || user.platform_role === "venue_admin";
  if (row.status === "published") return { visible: true, manages };
  if (manages) return { visible: true, manages };
  if (row.status === "cancelled" && row.my_status) return { visible: true, manages: false };
  return { visible: false, manages: false };
}

async function load_event(db, user, id, now) {
  const [row] = await event_rows(db, { viewer_id: user.id, where: "e.id = ?", params: [id] });
  if (!row) return null;
  const { visible, manages } = access(row, user, now);
  if (!visible) return null;
  const tags = (await tags_for(db, [row.id])).get(row.id);
  return { row, dto: event_dto(row, tags, now, { manages }), manages };
}

export { QUEUE_LIMIT, WAITING, access, eligibility, event_dto, event_rows, load_event, needs_approval, normalize_status, registration_status, tags_for, to_db };
