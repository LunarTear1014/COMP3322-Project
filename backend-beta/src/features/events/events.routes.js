import { Router } from "express";
import { invalid_request, database_error } from "../../shared/http.js";
import { timeslot_bounds } from "../../shared/timeslots.js";
import { validate_event_input } from "./events.validation.js";
import {
  join_event,
  leave_event,
  list_events,
  create_event,
} from "./events.service.js";

const router = Router();

function parse_event_id(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const event_id = Number(value);
  return Number.isSafeInteger(event_id) ? event_id : null;
}

// GET /api/events
router.get("/api/events", async (req, res) => {
  try {
    res.json(await list_events(req.session?.user_id));
  } catch (error) {
    database_error(res, error);
  }
});

router.post("/api/events/:event_id/participation", async (req, res) => {
  const event_id = parse_event_id(req.params.event_id);
  if (event_id === null) {
    return invalid_request(res, "Event ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Sign in to join an event." });
  }

  try {
    const result = await join_event(event_id, req.session?.user_id);
    if (result.ok) {
      return res.status(result.status === "waitlisted" ? 202 : 201).json({
        status: result.status,
        message:
          result.status === "waitlisted"
            ? "The event is full. You have been added to the waitlist."
            : "You joined the event.",
      });
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Event not found." });
    }
    if (result.reason === "membership_required") {
      return res.status(403).json({
        message: "Join the organizing club before joining this event.",
      });
    }
    if (result.reason === "already_joined") {
      return res.status(409).json({ message: "You already joined this event." });
    }
    if (result.reason === "unavailable") {
      return res.status(409).json({ message: "This event is not available." });
    }
    if (result.reason === "already_waitlisted") {
      return res.status(409).json({
        message: "You are already on this event's waitlist.",
      });
    }
    return database_error(res, result.error);
  } catch (error) {
    return database_error(res, error);
  }
});

router.delete("/api/events/:event_id/participation", async (req, res) => {
  const event_id = parse_event_id(req.params.event_id);
  if (event_id === null) {
    return invalid_request(res, "Event ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Sign in to change event participation." });
  }

  try {
    const result = await leave_event(event_id, req.session?.user_id);
    if (result.ok) {
      return res.status(204).end();
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Event not found." });
    }
    return res.status(409).json({ message: "You have not joined this event." });
  } catch (error) {
    return database_error(res, error);
  }
});

// POST /api/events: book the venue and create the event in one transaction.
router.post("/api/events", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({
      message: "Sign in as a committee member or president to book a venue.",
    });
  }

  const message = validate_event_input(req.body);
  if (message) {
    return invalid_request(res, message);
  }

  const { club, title, description, date, venue, timeslot, visibility } =
    req.body;
  const bounds = timeslot_bounds(date, timeslot);

  const result = await create_event({
    club,
    title,
    description,
    date,
    venue,
    timeslot,
    visibility,
    bounds,
    user_id: req.session.user_id,
  });

  if (result.ok) {
    return res.status(201).json(result.event);
  }
  if (result.reason === "conflict") {
    return res.status(409).json({ message: result.message });
  }
  if (result.reason === "forbidden") {
    return res.status(403).json({ message: result.message });
  }
  if (result.reason === "database") {
    return database_error(res, result.error);
  }
  return invalid_request(res, result.message);
});

export default router;
