// Generates er.svg (core ClubSpace entities) for the final documentation.
// Columns and keys come from the schema after all migrations (023_view_membership).
//   node docs/final-report/er-diagram.mjs
import { writeFileSync } from "node:fs";

const W = 190, HEAD = 24, ROW = 15, PAD = 7;
const X = [10, 230, 450, 670, 890];
const E = {};
function ent(name, col, y, cols, group) {
  const h = HEAD + cols.length * ROW + PAD;
  E[name] = { name, x: X[col], y, w: W, h, cols, group };
}
// [column, key badge]
ent("member_removal_requests", 0, 170, [["id", "PK"], ["club_id", "FK"], ["user_id", "FK"], ["requested_by", "FK"], ["status", ""], ["decided_by", "FK"], ["version", ""]], "club");
ent("club_tags", 0, 40, [["id", "PK"], ["club_id", "FK"], ["name", ""], ["name_key (generated)", "UQ*"]], "club");
ent("clubs", 1, 40, [["id", "PK"], ["name", "UQ"], ["description", ""], ["icon_key", ""], ["photo_key", ""]], "club");
ent("memberships", 2, 40, [["user_id", "PK FK"], ["club_id", "PK FK"], ["role", ""], ["president_club_id (gen.)", "UQ"], ["version", ""]], "club");
ent("club_join_requests", 3, 40, [["id", "PK"], ["user_id", "FK"], ["club_id", "FK"], ["status", ""], ["reviewed_by", "FK"]], "club");
ent("users", 4, 40, [["id", "PK"], ["email", "UQ"], ["password_hash", ""], ["name", ""], ["student_id", "UQ"], ["google_sub", "UQ"], ["platform_role", ""]], "user");
ent("bookings", 1, 210, [["id", "PK"], ["venue_id", "FK"], ["club_id", "FK"], ["start_time / end_time", ""], ["status", ""], ["requested_by", "FK"], ["decided_by", "FK"], ["version", ""]], "venue");
ent("venues", 1, 384, [["id", "PK"], ["name", "UQ"], ["location", ""], ["capacity", ""], ["is_active", ""]], "venue");
ent("events", 2, 210, [["id", "PK"], ["booking_id", "FK UQ"], ["club_id", "FK"], ["created_by", "FK"], ["title", ""], ["start_time / end_time", ""], ["visibility", ""], ["status", ""], ["capacity", ""], ["registration_closes_at", ""], ["checkin_code", ""], ["cover_key", ""], ["version", ""]], "event");
ent("event_club_tags", 2, 470, [["event_id", "PK FK"], ["club_tag_id", "PK FK"]], "event");
ent("event_campus_tags", 2, 560, [["event_id", "PK FK"], ["campus_tag_id", "PK FK"]], "event");
ent("campus_tags", 1, 546, [["id", "PK"], ["slug", "UQ"], ["name", ""]], "venue");
ent("participations", 3, 210, [["user_id", "PK FK"], ["event_id", "PK FK"], ["status", ""], ["queued_at", ""], ["confirmed_at", ""]], "link");
ent("event_join_requests", 3, 333, [["event_id", "PK FK"], ["user_id", "PK FK"], ["status", ""], ["allow_waitlist", ""]], "link");
ent("event_attendance", 3, 441, [["event_id", "PK FK"], ["user_id", "PK FK"], ["method", ""], ["checked_in_at", ""]], "link");
ent("event_views", 3, 549, [["id", "PK"], ["event_id", "FK"], ["user_id", "FK"], ["source", ""], ["viewer_role", ""]], "link");
ent("participation_history", 3, 672, [["id", "PK"], ["event_id", "FK"], ["user_id", "FK"], ["action", ""], ["from_status / to_status", ""]], "link");
ent("notifications", 4, 210, [["id", "PK"], ["user_id", "FK"], ["event_id", "FK"], ["club_id", "FK"], ["type", ""], ["dedup_key", ""], ["read_at", ""]], "user");

const fill = { club: "#E8F0FE", user: "#FDECEA", venue: "#E6F4EA", event: "#FFF4E0", link: "#F3E8FD" };
const stroke = { club: "#3B6FD8", user: "#C5483B", venue: "#2E8B57", event: "#C98A12", link: "#8A4FD0" };

let out = "";
const L = (pts, dash = false) => {
  out += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#5F6368" stroke-width="1.3"${dash ? ' stroke-dasharray="4 3"' : ""}/>`;
};
const T = (x, y, s, anchor = "middle") => { out += `<text x="${x}" y="${y}" class="card" text-anchor="${anchor}">${s}</text>`; };
// crow's foot "many" end at point p, entering the box in direction d (unit vector toward the box)
const many = ([x, y], [dx, dy]) => {
  const bx = x - dx * 10, by = y - dy * 10;
  const nx = -dy, ny = dx;
  out += `<polyline points="${x + nx * 6},${y + ny * 6} ${bx},${by} ${x - nx * 6},${y - ny * 6}" fill="none" stroke="#5F6368" stroke-width="1.3"/>`;
  out += `<line x1="${x}" y1="${y}" x2="${bx}" y2="${by}" stroke="#5F6368" stroke-width="1.3"/>`;
};
// "exactly one" end: two short bars across the line near point p
const one = ([x, y], [dx, dy]) => {
  const nx = -dy, ny = dx;
  for (const k of [5, 9]) {
    const cx = x - dx * k, cy = y - dy * k;
    out += `<line x1="${cx + nx * 5}" y1="${cy + ny * 5}" x2="${cx - nx * 5}" y2="${cy - ny * 5}" stroke="#5F6368" stroke-width="1.3"/>`;
  }
};
const r = (n) => E[n].x + E[n].w, b = (n) => E[n].y + E[n].h, mid = (n) => E[n].y + E[n].h / 2, cx = (n) => E[n].x + E[n].w / 2;

// clubs 1—N club_tags
L([[r("club_tags"), 70], [E.clubs.x, 70]]); many([r("club_tags"), 70], [-1, 0]); one([E.clubs.x, 70], [1, 0]);
// clubs 1—N member_removal_requests (bottom edge of clubs, across the club_tags trunk)
L([[250, b("clubs")], [250, 190], [r("member_removal_requests"), 190]]); one([250, b("clubs")], [0, -1]); many([r("member_removal_requests"), 190], [-1, 0]);
// clubs 1—N memberships
L([[r("clubs"), 70], [E.memberships.x, 70]]); one([r("clubs"), 70], [-1, 0]); many([E.memberships.x, 70], [1, 0]);
// users 1—N memberships (over the top)
L([[cx("memberships"), 40], [cx("memberships"), 24], [cx("users"), 24], [cx("users"), 40]]);
many([cx("memberships"), 40], [0, 1]); one([cx("users"), 40], [0, 1]);
// users 1—N club_join_requests
L([[r("club_join_requests"), 100], [E.users.x, 100]]); many([r("club_join_requests"), 100], [-1, 0]); one([E.users.x, 100], [1, 0]);
// clubs 1—N club_join_requests (under memberships)
L([[E.clubs.x + 180, b("clubs")], [E.clubs.x + 180, 172], [cx("club_join_requests"), 172], [cx("club_join_requests"), b("club_join_requests")]]);
one([E.clubs.x + 180, b("clubs")], [0, -1]); many([cx("club_join_requests"), b("club_join_requests")], [0, -1]);
// clubs 1—N bookings
L([[cx("clubs"), b("clubs")], [cx("clubs"), E.bookings.y]]); one([cx("clubs"), b("clubs")], [0, -1]); many([cx("clubs"), E.bookings.y], [0, 1]);
// clubs 1—N events
L([[E.clubs.x + 160, b("clubs")], [E.clubs.x + 160, 190], [E.events.x + 60, 190], [E.events.x + 60, E.events.y]]);
one([E.clubs.x + 160, b("clubs")], [0, -1]); many([E.events.x + 60, E.events.y], [0, 1]);
// venues 1—N bookings
L([[cx("venues"), b("bookings")], [cx("venues"), E.venues.y]]); many([cx("venues"), b("bookings")], [0, -1]); one([cx("venues"), E.venues.y], [0, 1]);
// bookings 1—1 events
L([[r("bookings"), 262], [E.events.x, 262]]); one([r("bookings"), 262], [-1, 0]); one([E.events.x, 262], [1, 0]);
T(435, 255, "1 : 1");
// events 1—N event_club_tags (vertical) ; club_tags 1—N event_club_tags
L([[cx("events"), b("events")], [cx("events"), E.event_club_tags.y]]); one([cx("events"), b("events")], [0, -1]); many([cx("events"), E.event_club_tags.y], [0, 1]);
L([[E.event_club_tags.x, mid("event_club_tags")], [215, mid("event_club_tags")], [215, 140], [cx("club_tags"), 140], [cx("club_tags"), b("club_tags")]]);
many([E.event_club_tags.x, mid("event_club_tags")], [1, 0]); one([cx("club_tags"), b("club_tags")], [0, -1]);
// campus_tags 1—N event_campus_tags
L([[r("campus_tags"), mid("event_campus_tags")], [E.event_campus_tags.x, mid("event_campus_tags")]]);
one([r("campus_tags"), mid("event_campus_tags")], [-1, 0]); many([E.event_campus_tags.x, mid("event_campus_tags")], [1, 0]);
// event_id bus: events 1 — N (participations, event_join_requests, event_attendance, event_views, participation_history, event_campus_tags)
const BUS_E = 655;
const linkTables = ["participations", "event_join_requests", "event_attendance", "event_views", "participation_history"];
L([[r("events"), 330], [BUS_E, 330]]); one([r("events"), 330], [-1, 0]);
L([[BUS_E, mid("participations")], [BUS_E, mid("participation_history")]]);
for (const n of linkTables) { L([[BUS_E, mid(n)], [E[n].x, mid(n)]]); many([E[n].x, mid(n)], [1, 0]); }
L([[r("event_campus_tags"), mid("event_campus_tags")], [BUS_E, mid("event_campus_tags")]]); many([r("event_campus_tags"), mid("event_campus_tags")], [-1, 0]);
// user_id bus: users 1 — N link tables
const BUS_U = 875;
L([[E.users.x, 150], [BUS_U, 150], [BUS_U, mid("participation_history")]]); one([E.users.x, 150], [1, 0]);
for (const n of linkTables) { L([[r(n), mid(n)], [BUS_U, mid(n)]]); many([r(n), mid(n)], [-1, 0]); }
// users 1—N notifications
L([[cx("users"), b("users")], [cx("users"), E.notifications.y]]); one([cx("users"), b("users")], [0, -1]); many([cx("users"), E.notifications.y], [0, 1]);

// boxes on top of lines
let boxes = "";
for (const e of Object.values(E)) {
  boxes += `<g><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="6" fill="#fff" stroke="${stroke[e.group]}" stroke-width="1.4"/>`;
  boxes += `<path d="M${e.x},${e.y + 6} a6,6 0 0 1 6,-6 h${e.w - 12} a6,6 0 0 1 6,6 v${HEAD - 6} h-${e.w} z" fill="${fill[e.group]}" stroke="${stroke[e.group]}" stroke-width="1.4"/>`;
  boxes += `<text x="${e.x + 9}" y="${e.y + 16.5}" class="title">${e.name}</text>`;
  e.cols.forEach(([c, k], i) => {
    const y = e.y + HEAD + 12 + i * ROW;
    const pk = k.includes("PK");
    boxes += `<text x="${e.x + 9}" y="${y}" class="col${pk ? " pk" : ""}">${c}</text>`;
    if (k) boxes += `<text x="${e.x + e.w - 8}" y="${y}" class="key" text-anchor="end">${k}</text>`;
  });
  boxes += "</g>";
}
boxes += `<text transform="translate(${BUS_E - 5},660) rotate(-90)" class="bus" text-anchor="middle">event_id</text>`;
boxes += `<text transform="translate(${BUS_U + 12},640) rotate(-90)" class="bus" text-anchor="middle">user_id</text>`;
const H = Math.max(...Object.values(E).map((e) => e.y + e.h)) + 12;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1090 ${H}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">
<style>.title{font-size:12px;font-weight:700;fill:#202124}.col{font-size:10.5px;fill:#3C4043}.pk{font-weight:700;text-decoration:underline}.key{font-size:9px;font-weight:700;fill:#80868B;letter-spacing:.3px}.card{font-size:10px;fill:#5F6368}.bus{font-size:10px;font-style:italic;fill:#5F6368}</style>
${out}${boxes}</svg>`;
writeFileSync(new URL("./er.svg", import.meta.url), svg);
console.log("er.svg", H);
