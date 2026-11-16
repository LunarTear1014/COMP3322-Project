import { randomBytes } from "node:crypto";
import session from "express-session";
import { create_app } from "../app.js";
import { create_v1_stack } from "../api_v1/stack.js";
import { create_password_hasher } from "../features/users/password_hasher.js";
import { campus_to_utc, slot_by_id, utc_to_campus_date } from "../shared/slots.js";

// Demo data for a fresh deployment: 5 clubs, a venue administrator, a
// president, two committee members and three members per club, six students
// with no club, and 25 events spread over the three weeks around today.
//
// Everything after the accounts goes through the real v1 API, so events,
// bookings, sign-offs, registrations, waitlists, join requests, check-ins,
// notifications and audit rows look exactly as if people had used the app.
// Past events are created on a simulated clock that is moved back in time.
//
// Every account shares one password (DEMO_ACCOUNT_PASSWORD). Nothing secret is
// stored in the repository. All addresses use the reserved .example domain.

const DOMAIN = "clubspace.example";
const ORIGIN = "http://demo-seed.invalid";
const DAY_MS = 86_400_000;

const CLUBS = [
  { key: "photo", name: "Photography Society", description: "A campus community for students interested in photography.", tags: ["Beginner friendly", "Outdoor"] },
  { key: "film", name: "Film Society", description: "Film screenings and discussions for university students.", tags: ["Screening", "Workshop"] },
  { key: "debate", name: "Debate Club", description: "Practice debates and public-speaking workshops.", tags: ["BP format", "Social"] },
  { key: "hiking", name: "Hiking Club", description: "Weekend hikes across Hong Kong's country parks, for every fitness level.", tags: ["Beginner friendly", "Advanced"] },
  { key: "robotics", name: "Robotics Lab", description: "Build, code and race small robots with other makers.", tags: ["Hands-on", "Competition"] },
];

const VENUES = [
  { name: "Lok Yew Hall", location: "Main Campus", capacity: 80, description: "A flexible hall for student activities." },
  { name: "Main Building Room 230", location: "Main Building", capacity: 35, description: "A seminar room in the Main Building." },
  { name: "GoldenScene Cinema", location: "Kennedy Town", capacity: 120, description: "A cinema for screenings and talks." },
  { name: "Student Union Activity Room", location: "Student Union Building", capacity: 40, description: "A carpeted room with movable tables and a projector." },
  { name: "Sports Centre Studio", location: "Sports Centre", capacity: 30, description: "A studio for briefings, warm-ups and small workshops." },
];
const V = { hall: "Lok Yew Hall", room: "Main Building Room 230", cinema: "GoldenScene Cinema", union: "Student Union Activity Room", studio: "Sports Centre Studio" };

// Fictional names (no real people): president, committee x2, members x3 per club.
const PEOPLE = {
  photo: ["Chan Hiu Tung", "Ho Wing Lam", "Kwok Chi Yeung", "Lee Sum Yi", "Yuen Pak Hei", "So Hoi Lam"],
  film: ["Leung Ka Ho", "Tang Wai Man", "Chow Ching Yan", "Siu Lok Tin", "Kwan Hei Tung", "Lo Yan Ting"],
  debate: ["Wong Tsz Yan", "Au Yeung Chun", "Fong Sze Wing", "Choi Ka Lok", "Hung Mei Yee", "Tam Ho Ching"],
  hiking: ["Cheung Yuk Ching", "Lui Tsz Hin", "Ma Wing Yan", "Kong Chun Hei", "Yau Hiu Lam", "Wan Ka Yee"],
  robotics: ["Ng Chun Wai", "Pang Hoi Yin", "Ip Ka Chun", "Chu Wing Sze", "Shum Tsz Lok", "Liu Yan Kiu"],
};
const STUDENTS = ["Lau Wing Sze", "Tse Ho Yin", "Yip Sin Yi", "Fung Kai Chung", "Mak Hoi Ying", "Poon Chi Hang"];

// Extra plain memberships, so a few people belong to two clubs.
const EXTRA_MEMBERS = [["member1.photo", "film"], ["member2.hiking", "robotics"], ["member3.debate", "photo"], ["student4", "hiking"]];
// Club join requests left for the committee to review.
const CLUB_REQUESTS = [["student1", "photo"], ["student2", "robotics"], ["student3", "hiking"]];

// day: offset from today (Hong Kong). reg: how many people register.
// attend: past events only, how many check in (the last one is marked by the
// committee, the rest use the code). accept: members-only events, how many
// requests the committee accepts (the rest stay pending).
// flow: published (default), past, president_signoff, venue_pending,
// publish_signoff, cancelled.
const EVENTS = [
  // Past, with attendance for the reports.
  { club: "photo", venue: V.hall, day: -18, slot: "afternoon", title: "Golden Hour Photo Walk", capacity: 20, tags: ["arts", "social"], club_tags: ["Outdoor", "Beginner friendly"], reg: 7, attend: 5, flow: "past",
    description: "Meet at Lok Yew Hall, then walk to the Centennial Campus terraces to shoot the sunset. Bring any camera, phones welcome." },
  { club: "film", venue: V.cinema, day: -14, slot: "evening", title: "Hong Kong New Wave Screening", capacity: 60, tags: ["arts", "culture"], club_tags: ["Screening"], reg: 9, attend: 6, flow: "past",
    description: "A screening of an early 1980s Hong Kong New Wave feature, followed by a short discussion led by the committee." },
  { club: "debate", venue: V.room, day: -12, slot: "afternoon", title: "Intro to British Parliamentary Debate", capacity: 30, tags: ["academic"], club_tags: ["BP format"], reg: 6, attend: 4, flow: "past",
    description: "Learn the four-team BP format, the roles of each speaker and how adjudicators score a round. No experience needed." },
  { club: "hiking", venue: V.studio, day: -9, slot: "morning", title: "Dragon's Back Trail Briefing", capacity: 25, tags: ["sports"], club_tags: ["Beginner friendly"], reg: 6, attend: 6, flow: "past",
    description: "Route, kit list and safety briefing before the club's first Dragon's Back hike." },
  { club: "robotics", venue: V.union, day: -7, slot: "afternoon", title: "Line-Follower Robot Workshop", capacity: 12, visibility: "members_only", tags: ["tech"], club_tags: ["Hands-on"], reg: 4, accept: 4, attend: 3, flow: "past",
    description: "Build a two-wheel line follower from the club's kit and tune its sensor thresholds. Members only, kits are limited." },
  { club: "photo", venue: V.room, day: -3, slot: "evening", title: "Portrait Lighting Basics", capacity: 10, visibility: "members_only", tags: ["arts"], club_tags: ["Beginner friendly"], reg: 4, accept: 4, attend: 3, flow: "past",
    description: "One-light and two-light portrait set-ups with the society's speedlights." },

  // Upcoming and open for registration.
  { club: "photo", venue: V.hall, day: 2, slot: "evening", title: "Night Photography on the Harbourfront", capacity: 25, tags: ["arts", "social"], club_tags: ["Outdoor"], reg: 6,
    description: "Long exposures of the harbour lights. Bring a tripod if you have one; the society lends a few." },
  { club: "film", venue: V.cinema, day: 3, slot: "evening", title: "Short Film Pitch Night", capacity: 80, tags: ["arts", "career"], club_tags: ["Workshop"], reg: 7,
    description: "Pitch a five-minute short film idea in two minutes. The best three pitches get the club's camera kit for a weekend." },
  { club: "debate", venue: V.union, day: 4, slot: "evening", title: "Debate Social: Pizza and Motions", capacity: 30, tags: ["social", "free-food"], club_tags: ["Social"], reg: 5,
    description: "Casual impromptu motions over pizza. A relaxed way to meet the club." },
  { club: "hiking", venue: V.studio, day: 5, slot: "morning", title: "Lion Rock Sunrise Hike", capacity: 6, tags: ["sports"], club_tags: ["Advanced"], reg: 8,
    description: "An early, steep climb up Lion Rock. Places are limited to six per guide, so later sign-ups join the waitlist." },
  { club: "robotics", venue: V.hall, day: 6, slot: "afternoon", title: "Robot Sumo Tournament", capacity: 40, tags: ["tech", "social"], club_tags: ["Competition"], reg: 6,
    description: "Bring a robot under 500 g, or come to watch. Brackets are drawn on the day." },
  { club: "photo", venue: V.union, day: 7, slot: "afternoon", title: "Film Camera Swap Meet", capacity: 30, tags: ["arts", "social"], club_tags: [], reg: 4,
    description: "Swap, sell or just look at film cameras and lenses. The committee will test shutters on request." },
  { club: "film", venue: V.cinema, day: 8, slot: "evening", title: "Members' Screening: Classic Noir", capacity: 40, visibility: "members_only", tags: ["arts", "culture"], club_tags: ["Screening"], reg: 4, accept: 2,
    description: "A members-only double bill of 1940s film noir. Popcorn provided." },
  { club: "debate", venue: V.room, day: 9, slot: "morning", title: "Inter-Hall Debate Trials", capacity: 16, visibility: "members_only", tags: ["academic"], club_tags: ["BP format"], reg: 4, accept: 1,
    description: "Trials for the team that represents the club at the inter-hall competition. Members only." },
  { club: "hiking", venue: V.studio, day: 10, slot: "morning", title: "MacLehose Stage 2 Day Hike", capacity: 20, tags: ["sports"], club_tags: ["Advanced"], reg: 5,
    description: "Sai Wan to Pak Tam Au with a swim stop at Tai Long Wan. About seven hours of walking." },
  { club: "robotics", venue: V.room, day: 11, slot: "afternoon", title: "Arduino for Beginners", capacity: 30, tags: ["tech", "academic"], club_tags: ["Hands-on"], reg: 7,
    description: "Blink an LED, read a sensor and drive a servo. Laptops needed; boards provided." },
  { club: "photo", venue: V.room, day: 12, slot: "evening", title: "Photo Critique Circle", capacity: 12, visibility: "members_only", tags: ["arts"], club_tags: [], reg: 3, accept: 2,
    description: "Bring three photos for friendly feedback from the committee and other members." },
  { club: "film", venue: V.union, day: 14, slot: "afternoon", title: "Screenwriting Workshop", capacity: 25, tags: ["arts", "academic"], club_tags: ["Workshop"], reg: 3,
    description: "Structure, scene goals and dialogue, with short writing exercises." },
  { club: "debate", venue: V.hall, day: 15, slot: "morning", title: "Public Speaking Bootcamp", capacity: 50, tags: ["career", "academic"], club_tags: [], reg: 4,
    description: "Voice, pacing and handling questions, for interviews and presentations as much as debates." },
  { club: "robotics", venue: V.hall, day: 18, slot: "afternoon", title: "Robotics Lab Open Day", capacity: 80, tags: ["tech", "social"], club_tags: [], reg: 3,
    description: "Try the club's robots, see current projects and meet the build teams." },
  { club: "hiking", venue: V.studio, day: 20, slot: "morning", title: "Volunteer Trail Clean-up", capacity: 25, tags: ["volunteering", "sports"], club_tags: ["Beginner friendly"], reg: 4,
    description: "Litter picking along a country park trail with the park wardens. Gloves and bags provided." },

  // Still moving through the approval workflow.
  { club: "photo", venue: V.room, day: 16, slot: "afternoon", title: "Exhibition Planning Meeting", capacity: 20, visibility: "members_only", tags: ["arts"], club_tags: [], flow: "president_signoff", by: "committee1",
    description: "Plan the end-of-term exhibition: theme, venue and printing budget." },
  { club: "film", venue: V.cinema, day: 21, slot: "evening", title: "Animation Night", capacity: 60, tags: ["arts", "social"], club_tags: ["Screening"], flow: "venue_pending",
    description: "Hand-drawn and stop-motion shorts from around the world." },
  { club: "debate", venue: V.union, day: 13, slot: "afternoon", title: "Debate Workshop: Rebuttals", capacity: 25, tags: ["academic"], club_tags: ["BP format"], flow: "publish_signoff", by: "committee1",
    description: "Practise rebuttal structure and weighing in short drills." },

  // Cancelled after people registered.
  { club: "robotics", venue: V.studio, day: 17, slot: "afternoon", title: "Drone Racing Demo", capacity: 20, tags: ["tech"], club_tags: ["Competition"], reg: 3, flow: "cancelled",
    cancel_reason: "The drone cage is under repair. We will announce a new date soon.",
    description: "Watch FPV drone pilots race through the club's indoor course." },
];

const SOURCES = ["explore", "club", "inbox", "my_events", "share"];

// Sessions for the seeder's own logins, kept in memory and dropped on exit.
// (express-session warns about its MemoryStore whenever NODE_ENV is production.)
class SeedSessionStore extends session.Store {
  sessions = new Map();
  get(id, done) { const text = this.sessions.get(id); done(null, text ? JSON.parse(text) : null); }
  set(id, data, done) { this.sessions.set(id, JSON.stringify(data)); done?.(); }
  destroy(id, done) { this.sessions.delete(id); done?.(); }
  touch(id, data, done) { done?.(); }
}

// A cookie-and-CSRF aware client for the in-process app.
class Client {
  constructor(base) { this.base = base; this.cookie = ""; this.csrf = null; }

  async request(method, path, body) {
    const headers = { Origin: ORIGIN };
    if (method !== "GET") {
      if (!this.csrf) this.csrf = (await this.request("GET", "/auth/csrf")).data.csrf_token;
      headers["X-CSRF-Token"] = this.csrf;
      headers["Content-Type"] = "application/json";
    }
    if (this.cookie) headers.Cookie = this.cookie;
    const response = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    const set = response.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${json?.error?.code ?? ""} ${json?.error?.message ?? ""}`.trim());
    return json ?? {};
  }

  get(path) { return this.request("GET", path); }
  post(path, body) { return this.request("POST", path, body); }
  put(path, body) { return this.request("PUT", path, body); }
}

const add_days = (date, days) => utc_to_campus_date(new Date(campus_to_utc(date, "12:00").getTime() + days * DAY_MS));

function account_list() {
  const accounts = [{ key: "admin", email: `admin@${DOMAIN}`, name: "Venue Administrator", platform_role: "venue_admin" }];
  for (const club of CLUBS) {
    const [president, c1, c2, m1, m2, m3] = PEOPLE[club.key];
    accounts.push(
      { key: `president.${club.key}`, name: president, club: club.key, role: "president" },
      { key: `committee1.${club.key}`, name: c1, club: club.key, role: "committee" },
      { key: `committee2.${club.key}`, name: c2, club: club.key, role: "committee" },
      { key: `member1.${club.key}`, name: m1, club: club.key, role: "member" },
      { key: `member2.${club.key}`, name: m2, club: club.key, role: "member" },
      { key: `member3.${club.key}`, name: m3, club: club.key, role: "member" },
    );
  }
  STUDENTS.forEach((name, index) => accounts.push({ key: `student${index + 1}`, name }));
  return accounts.map((account, index) => ({
    platform_role: "student", ...account,
    email: account.email ?? `${account.key}@${DOMAIN}`,
    student_id: `DEMO${String(index + 1).padStart(4, "0")}`,
  }));
}

// Returns why seeding should be skipped, or null when the database is empty.
async function skip_reason(pool) {
  const [[{ events }]] = await pool.query("SELECT COUNT(*) AS events FROM events");
  if (Number(events) > 0) return "The database already has events.";
  const [[{ demo }]] = await pool.query("SELECT COUNT(*) AS demo FROM users WHERE email LIKE ?", [`%@${DOMAIN}`]);
  if (Number(demo) > 0) return "Demo accounts already exist.";
  return null;
}

async function seed_demo({ pool, password, now = new Date(), hasher = create_password_hasher(), log = console.log }) {
  if (!password || password.length < 12) throw new Error("DEMO_ACCOUNT_PASSWORD must be at least 12 characters.");
  const reason = await skip_reason(pool);
  if (reason) return { skipped: reason };

  // ---- catalogue and accounts (direct SQL; no API creates these) -------------
  const club_ids = {};
  for (const club of CLUBS) {
    await pool.query("INSERT INTO clubs (name, description) SELECT ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM clubs WHERE name = ?)", [club.name, club.description, club.name]);
    club_ids[club.key] = (await pool.query("SELECT id FROM clubs WHERE name = ?", [club.name]))[0][0].id;
  }
  const venue_ids = {};
  for (const venue of VENUES) {
    await pool.query("INSERT INTO venues (name, location, capacity, description) SELECT ?, ?, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM venues WHERE name = ?)",
      [venue.name, venue.location, venue.capacity, venue.description, venue.name]);
    venue_ids[venue.name] = (await pool.query("SELECT id FROM venues WHERE name = ?", [venue.name]))[0][0].id;
  }
  const accounts = account_list();
  const password_hash = await hasher.hash(password);
  const users = {};
  for (const account of accounts) {
    const [insert] = await pool.query("INSERT INTO users (email, password_hash, name, student_id, platform_role) VALUES (?, ?, ?, ?, ?)",
      [account.email, password_hash, account.name, account.student_id, account.platform_role]);
    users[account.key] = { ...account, id: insert.insertId };
    if (account.club) await pool.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, ?)", [insert.insertId, club_ids[account.club], account.role]);
  }
  for (const [key, club] of EXTRA_MEMBERS) {
    await pool.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'member')", [users[key].id, club_ids[club]]);
  }

  // ---- the real API on a simulated clock -------------------------------------
  let clock_now = new Date(now);
  const set_clock = (date) => { clock_now = new Date(date); };
  const clock = () => (clock_now = new Date(clock_now.getTime() + 1));
  const stack = create_v1_stack({ pool, hasher, clock, throttle_limits: { login: 10_000, register: 10_000, ip: 100_000 }, hub_options: { logger: { error() {} } } });
  const app = create_app({ session_secret: randomBytes(32).toString("hex"), session_store: new SeedSessionStore(), app_origin: ORIGIN, v1_routers: stack.routers, is_multipart_route: stack.is_multipart_route, logger: { error() {} } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = new Map();
  const as = async (key) => {
    if (!clients.has(key)) {
      const client = new Client(base);
      await client.post("/auth/login", { email: users[key].email, password });
      client.csrf = (await client.get("/auth/csrf")).data.csrf_token;
      clients.set(key, client);
    }
    return clients.get(key);
  };

  const summary = { clubs: CLUBS.length, accounts: accounts.length, events: 0, registrations: 0, check_ins: 0 };
  try {
    // Club tags, created by each president.
    const tag_ids = {};
    for (const club of CLUBS) {
      for (const name of club.tags) {
        const tag = (await (await as(`president.${club.key}`)).post(`/clubs/${club_ids[club.key]}/tags`, { name })).data;
        tag_ids[`${club.key}:${name}`] = tag.id;
      }
    }
    const [campus_rows] = await pool.query("SELECT id, slug FROM campus_tags WHERE retired_at IS NULL");
    const campus = Object.fromEntries(campus_rows.map((row) => [row.slug, row.id]));

    // People who register for public events, in rotation: plain members and students.
    const pool_keys = accounts.filter((a) => a.role === "member" || a.key.startsWith("student")).map((a) => a.key);
    const today = utc_to_campus_date(now);
    let rotation = 0;

    // Past events first (moving the clock back), then today's view of the future.
    const ordered = [...EVENTS].sort((a, b) => a.day - b.day);
    for (const spec of ordered) {
      const date = add_days(today, spec.day);
      const start = campus_to_utc(date, slot_by_id(spec.slot).start);
      set_clock(spec.flow === "past" ? new Date(start.getTime() - 6 * DAY_MS) : now);
      const club_id = club_ids[spec.club];
      const president = await as(`president.${spec.club}`);
      const committee = await as(`committee1.${spec.club}`);
      const creator = spec.by ? await as(`${spec.by}.${spec.club}`) : president;
      const admin = await as("admin");

      let event = (await creator.post("/events", {
        club_id, venue_id: venue_ids[spec.venue], title: spec.title, description: spec.description, date, slot_id: spec.slot,
        visibility: spec.visibility ?? "public", capacity: spec.capacity,
        campus_tag_ids: spec.tags.map((slug) => campus[slug]), club_tag_ids: spec.club_tags.map((name) => tag_ids[`${spec.club}:${name}`]),
      })).data;
      summary.events += 1;
      if (spec.flow === "president_signoff") continue;
      if (event.booking.status === "awaiting_president") {
        event = (await president.post(`/bookings/${event.booking.id}/signoff`, { expected_version: event.booking.version, decision: "send" })).data ?? event;
        event = (await creator.get(`/events/${event.id}`)).data;
      }
      if (spec.flow === "venue_pending") continue;
      await admin.post(`/bookings/${event.booking.id}/decision`, { expected_version: event.booking.version, decision: "approve" });
      event = (await creator.get(`/events/${event.id}`)).data;
      event = (await creator.post(`/events/${event.id}/publish`, { expected_version: event.version })).data;
      if (spec.flow === "publish_signoff") continue;

      // Registrations.
      const members_only = spec.visibility === "members_only";
      const takers = [];
      if (members_only) {
        const [rows] = await pool.query("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.club_id = ? AND m.role = 'member' ORDER BY m.user_id", [club_id]);
        const keys = rows.map((row) => row.email.split("@")[0]);
        takers.push(...keys.slice(0, spec.reg));
      } else {
        while (takers.length < spec.reg) {
          const key = pool_keys[rotation++ % pool_keys.length];
          if (!takers.includes(key)) takers.push(key);
        }
      }
      for (const key of takers) {
        const client = await as(key);
        await client.post(`/events/${event.id}/views`, { source: SOURCES[rotation % SOURCES.length] });
        await client.post(`/events/${event.id}/registration`, { allow_waitlist: true });
        summary.registrations += 1;
      }
      // A few people look without registering.
      for (const key of pool_keys.slice((rotation + 3) % pool_keys.length).slice(0, 3)) {
        await (await as(key)).post(`/events/${event.id}/views`, { source: "explore" });
      }
      if (members_only) {
        for (const key of takers.slice(0, spec.accept ?? 0)) {
          await committee.post(`/events/${event.id}/join-requests/${users[key].id}/decision`, { decision: "accept" });
        }
      }

      if (spec.flow === "cancelled") {
        event = (await president.get(`/events/${event.id}`)).data;
        await president.post(`/events/${event.id}/cancel`, { expected_version: event.version, reason: spec.cancel_reason });
      }

      if (spec.flow === "past") {
        set_clock(new Date(start.getTime() + 10 * 60_000));
        const { code } = (await committee.post(`/events/${event.id}/checkin`, {})).data;
        const [joined] = await pool.query("SELECT user_id FROM participations WHERE event_id = ? AND status = 'joined' ORDER BY user_id", [event.id]);
        const present = joined.slice(0, spec.attend);
        for (const [index, row] of present.entries()) {
          const key = Object.keys(users).find((k) => users[k].id === row.user_id);
          if (index === present.length - 1) await committee.put(`/events/${event.id}/attendance/${row.user_id}`, {});
          else await (await as(key)).post(`/events/${event.id}/attendance`, { code });
          summary.check_ins += 1;
        }
      }
    }

    // Club join requests waiting for the committee (today).
    set_clock(now);
    for (const [key, club] of CLUB_REQUESTS) await (await as(key)).put(`/clubs/${club_ids[club]}/membership`, {});
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  log?.(`Demo data: ${summary.clubs} clubs, ${summary.accounts} accounts, ${summary.events} events, ${summary.registrations} registrations, ${summary.check_ins} check-ins.`);
  return { summary, accounts: accounts.map(({ email, name, platform_role, club, role }) => ({ email, name, platform_role, club, role })) };
}

export { CLUBS, DOMAIN, EVENTS, account_list, seed_demo, skip_reason };
