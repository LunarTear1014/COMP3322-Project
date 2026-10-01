import express from "express";

const app = express();
app.use(express.json());

// ---------- Fixed lists (same ones your pages use) ----------
const CLUBS = ["Photography Society", "Film Society", "Debate Club"];
const VISIBILITIES = ["Public", "Members only"];
const TIMESLOTS = ["10:00 - 12:00", "13:00 - 15:00", "16:00 - 18:00"];

// ---------- Helpers ----------
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/; // e.g. 2026-10-06

function today() {
  return new Date().toISOString().slice(0, 10);
}

function days_from_now(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Status is worked out from the date, so it never goes stale
function with_status(event) {
  return { ...event, status: event.date >= today() ? "Upcoming" : "Past" };
}

// ---------- In-memory data (resets when the server restarts) ----------
const venues = [
  { id: 1, name: "Happy Park Hall", location: "Main Campus", capacity: 80 },
  { id: 2, name: "Student Union Room 301", location: "Student Union", capacity: 35 },
  { id: 3, name: "GoldenScene Cinema", location: "Arts Building", capacity: 120 },
];

// An event IS a venue booking: venue + date + timeslot must be unique
let events = [
  {
    id: 1,
    title: "Photography Society Gathering",
    club: "Photography Society",
    date: days_from_now(5),
    timeslot: "16:00 - 18:00",
    venue: "Happy Park Hall",
    description: "A casual photography walk for students interested in taking better campus photos.",
    visibility: "Public",
    joined_count: 18,
  },
  {
    id: 2,
    title: "Film Society Screening",
    club: "Film Society",
    date: days_from_now(1),
    timeslot: "16:00 - 18:00",
    venue: "GoldenScene Cinema",
    description: "Watch a selected film with other students, followed by a group discussion.",
    visibility: "Members only",
    joined_count: 25,
  },
  {
    id: 3,
    title: "Debate Club Meeting",
    club: "Debate Club",
    date: days_from_now(-7),
    timeslot: "13:00 - 15:00",
    venue: "Student Union Room 301",
    description: "A practice debate for students who want to improve public-speaking skills.",
    visibility: "Public",
    joined_count: 12,
  },
];
let next_event_id = 4;

let profile = {
  name: "Charlie Chan",
  email: "charlie@example.com",
  programme: "Computer Science",
};

// ---------- Routes ----------

// GET /api/events
app.get("/api/events", (req, res) => {
  res.json(events.map(with_status));
});

// POST /api/events   (the Booking page: book a venue AND create the event)
app.post("/api/events", (req, res) => {
  const { club, title, description, date, venue, timeslot, visibility } = req.body;

  if (!CLUBS.includes(club)) {
    return res.status(422).json({ message: "Unknown club" });
  }
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(422).json({ message: "Event title is required" });
  }
  if (typeof description !== "string" || description.trim() === "") {
    return res.status(422).json({ message: "Event description is required" });
  }
  if (typeof date !== "string" || !DATE_FORMAT.test(date)) {
    return res.status(422).json({ message: "Date must look like 2026-10-06" });
  }
  if (date < today()) {
    return res.status(422).json({ message: "The date cannot be in the past" });
  }
  if (!venues.some((v) => v.name === venue)) {
    return res.status(422).json({ message: "Unknown venue" });
  }
  if (!TIMESLOTS.includes(timeslot)) {
    return res.status(422).json({ message: "Unknown timeslot" });
  }
  if (!VISIBILITIES.includes(visibility)) {
    return res.status(422).json({ message: "Visibility must be Public or Members only" });
  }

  // 409 Conflict: the request is valid, but that slot is already taken
  const taken = events.some(
    (e) => e.venue === venue && e.date === date && e.timeslot === timeslot
  );
  if (taken) {
    return res
      .status(409)
      .json({ message: `${venue} is already booked on ${date}, ${timeslot}` });
  }

  const event = {
    id: next_event_id,
    title: title.trim(),
    club,
    date,
    timeslot,
    venue,
    description: description.trim(),
    visibility,
    joined_count: 0,
  };
  next_event_id += 1;
  events.push(event);
  res.status(201).json(with_status(event));
});

// GET /api/venues?date=2026-10-06
// Each timeslot says whether it is free on that date
app.get("/api/venues", (req, res) => {
  const date = req.query.date || today();
  if (!DATE_FORMAT.test(date)) {
    return res.status(422).json({ message: "Date must look like 2026-10-06" });
  }
  const result = venues.map((v) => ({
    ...v,
    timeslots: TIMESLOTS.map((time) => ({
      time,
      available: !events.some(
        (e) => e.venue === v.name && e.date === date && e.timeslot === time
      ),
    })),
  }));
  res.json(result);
});

// GET /api/profile
app.get("/api/profile", (req, res) => {
  res.json(profile);
});

// PUT /api/profile   (replaces the whole profile)
app.put("/api/profile", (req, res) => {
  const { name, email, programme } = req.body;
  if (typeof name !== "string" || name.trim() === "") {
    return res.status(422).json({ message: "Name is required" });
  }
  if (typeof email !== "string" || !email.includes("@")) {
    return res.status(422).json({ message: "Enter a valid email address" });
  }
  if (typeof programme !== "string" || programme.trim() === "") {
    return res.status(422).json({ message: "Programme is required" });
  }
  profile = { name: name.trim(), email: email.trim(), programme: programme.trim() };
  res.json(profile);
});

app.listen(3000, () => console.log("API on http://localhost:3000"));