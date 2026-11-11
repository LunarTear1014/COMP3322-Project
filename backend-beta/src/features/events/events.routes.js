import { Router } from "express";
import { invalid_request, database_error } from "../../shared/http.js";
import { timeslot_bounds } from "../../shared/timeslots.js";
import {
  validate_event_input,
  validate_event_edit_input,
  validate_event_details,
} from "./events.validation.js";
import {
  join_event,
  leave_event,
  list_events,
  list_my_participations,
  list_event_participants,
  create_event,
  edit_event,
  cancel_event,
  list_notifications,
  mark_notification_read,
} from "./events.service.js";

const router = Router();

function parse_event_id(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const event_id = Number(value);
  return Number.isSafeInteger(event_id) ? event_id : null;
}

function require_signed_in(req, res, message) {
  if (!Number.isSafeInteger(req.session?.user_id)) {
    res.status(401).json({ message });
    return false;
  }
  return true;
}

// GET /api/events
router.get("/api/events", async (req, res) => {
  const managed = req.query.managed === "true";
  if (managed && !require_signed_in(req, res, "Sign in to manage events.")) return;
  try {
    res.json(await list_events(req.session?.user_id, { managed }));
  } catch (error) {
    database_error(res, error);
  }
});

router.get("/api/events/mine", async (req, res) => {
  if (!require_signed_in(req, res, "Sign in to view your event participation.")) {
    return;
  }
  try {
    return res.json(await list_my_participations(req.session.user_id));
  } catch (error) {
    return database_error(res, error);
  }
});

router.get("/api/events/:event_id", async (req, res) => {
  const event_id = parse_event_id(req.params.event_id);
  if (event_id === null) return invalid_request(res, "Event ID must be a positive integer.");
  try {
    const [event] = await list_events(req.session?.user_id, { event_id });
    if (!event) return res.status(404).json({ message: "Event not found." });
    return res.json(event);
  } catch (error) {
    return database_error(res, error);
  }
});

router.get("/api/events/:event_id/participants", async (req, res) => {
  const event_id = parse_event_id(req.params.event_id);
  if (event_id === null) {
    return invalid_request(res, "Event ID must be a positive integer.");
  }
  if (!require_signed_in(req, res, "Sign in to view event participants.")) {
    return;
  }

  try {
    const result = await list_event_participants(
      event_id,
      req.session.user_id,
    );
    if (result.ok) {
      return res.json(result.participants);
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Event not found." });
    }
    return res.status(403).json({
      message: "Only this club's committee members or president can view participants.",
    });
  } catch (error) {
    return database_error(res, error);
  }
});

router.get("/api/notifications", async (req, res) => {
  if (!require_signed_in(req, res, "Sign in to view your notifications.")) {
    return;
  }
  try {
    res.json(await list_notifications(req.session.user_id));
  } catch (error) {
    database_error(res, error);
  }
});

router.patch("/api/notifications/:notification_id/read", async (req, res) => {
  const notification_id = parse_event_id(req.params.notification_id);
  if (notification_id === null) {
    return invalid_request(res, "Notification ID must be a positive integer.");
  }
  if (!require_signed_in(req, res, "Sign in to update notifications.")) {
    return;
  }
  try {
    const updated = await mark_notification_read(
      notification_id,
      req.session.user_id,
    );
    if (!updated) {
      return res.status(404).json({ message: "Notification not found." });
    }
    return res.status(204).end();
  } catch (error) {
    return database_error(res, error);
  }
});

router.delete("/api/events/:event_id", async (req, res) => {
  const event_id = parse_event_id(req.params.event_id);
  if (event_id === null) {
    return invalid_request(res, "Event ID must be a positive integer.");
  }
  if (!require_signed_in(req, res, "Sign in to cancel an event.")) {
    return;
  }

  try {
    const result = await cancel_event(event_id, req.session.user_id);
    if (result.ok) {
      return res.json({
        message: `${result.event_title} was cancelled. Signed-up users have been notified.`,
      });
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Event not found." });
    }
    if (result.reason === "forbidden") {
      return res.status(403).json({
        message: "Only this club's committee members or president can cancel its events.",
      });
    }
    if (result.reason === "already_cancelled") {
      return res.status(409).json({ message: "This event is already cancelled." });
    }
    return database_error(res, result.error);
  } catch (error) {
    return database_error(res, error);
  }
});

router.patch("/api/events/:event_id", async (req, res) => {
  const event_id = parse_event_id(req.params.event_id);
  if (event_id === null) {
    return invalid_request(res, "Event ID must be a positive integer.");
  }
  if (!require_signed_in(req, res, "Sign in to edit an event.")) {
    return;
  }

  const input = req.body ?? {};
  const details_only = Object.keys(input).every((key) => key === "title" || key === "description");
  const message = details_only ? validate_event_details(input) : validate_event_edit_input(input);
  if (message) {
    return invalid_request(res, message);
  }

  const { title, description, date, venue, timeslot, visibility } = input;
  const result = await edit_event(
    event_id,
    {
      title,
      description,
      date,
      venue,
      visibility,
      bounds: details_only ? null : timeslot_bounds(date, timeslot),
    },
    req.session.user_id,
  );

  if (result.ok) {
    return res.json({ message: "Event details updated. Participants have been notified." });
  }
  if (result.reason === "not_found") {
    return res.status(404).json({ message: "Event not found." });
  }
  if (result.reason === "forbidden") {
    return res.status(403).json({
      message: "Only this club's committee members or president can edit its events.",
    });
  }
  if (result.reason === "unavailable") {
    return res.status(409).json({ message: "Cancelled events cannot be edited." });
  }
  if (result.reason === "conflict" || result.reason === "unknown_venue") {
    return res.status(409).json({ message: result.message || "Unknown venue." });
  }
  return database_error(res, result.error);
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
    const allow_waitlist = req.body?.allow_waitlist;
    if (allow_waitlist !== undefined && typeof allow_waitlist !== "boolean") {
      return invalid_request(res, "allow_waitlist must be a boolean.");
    }
    const result = await join_event(event_id, req.session.user_id, allow_waitlist);
    if (result.ok) {
      return res.status(result.status === "pending" ? 202 : 201).json({
        status: result.status,
        message:
          result.status === "pending"
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
    if (result.reason === "already_pending") {
      return res.status(409).json({
        message: "You already have a pending registration for this event.",
      });
    }
    if (result.reason === "full") {
      return res.status(409).json({ message: "This event is full. Refresh to join its waitlist." });
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
