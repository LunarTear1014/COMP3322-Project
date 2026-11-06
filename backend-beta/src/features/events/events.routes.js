import { Router } from "express";
import { invalid_request, database_error } from "../../shared/http.js";
import { timeslot_bounds, utc_to_campus_datetime } from "../../shared/timeslots.js";
import { decideBooking, listPendingBookings, publishEvent } from "./approval.service.js";
import {
  validate_event_input,
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

function workflow_error(res, result) {
  if (result.reason === "not_found") return res.status(404).json({ message: "Request not found." });
  if (["forbidden", "self_decision"].includes(result.reason)) return res.status(403).json({ message: result.reason === "self_decision" ? "You cannot review your own committee club's request." : "You do not have permission for this action." });
  const messages = { stale: "This item has changed. Refresh and try again.", conflict: "The venue has been booked for that time.", invalid_state: "This action is no longer available." };
  return res.status(409).json({ message: messages[result.reason] || "The action could not be completed.", code: result.reason });
}

router.get("/api/bookings", async (req, res) => {
  if (!require_signed_in(req, res, "Sign in to review requests.")) return;
  try { const result = await listPendingBookings(req.session.user_id); return result.rows ? res.json(result.rows) : workflow_error(res, result); }
  catch (error) { return database_error(res, error); }
});

router.post("/api/bookings/:booking_id/decision", async (req, res) => {
  const bookingId = parse_event_id(req.params.booking_id);
  if (!bookingId) return invalid_request(res, "Booking ID must be a positive integer.");
  if (!require_signed_in(req, res, "Sign in to review requests.")) return;
  const { expected_version, decision, reason = "" } = req.body ?? {};
  if (!Number.isSafeInteger(expected_version) || expected_version < 1 || !["approve", "reject"].includes(decision) ||
      typeof reason !== "string" || reason.trim().length > 500 || (decision === "reject" && !reason.trim())) {
    return invalid_request(res, "Provide the current version and a valid decision; rejection requires a reason.");
  }
  try { const result = await decideBooking(bookingId, req.session.user_id, expected_version, decision, reason.trim()); return result.ok ? res.json(result) : workflow_error(res, result); }
  catch (error) { return database_error(res, error); }
});

router.post("/api/events/:event_id/publish", async (req, res) => {
  const eventId = parse_event_id(req.params.event_id);
  if (!eventId) return invalid_request(res, "Event ID must be a positive integer.");
  if (!require_signed_in(req, res, "Sign in to publish an event.")) return;
  const { expected_version } = req.body ?? {};
  if (!Number.isSafeInteger(expected_version) || expected_version < 1) return invalid_request(res, "Provide the current event version.");
  try { const result = await publishEvent(eventId, req.session.user_id, expected_version); return result.ok ? res.json(result) : workflow_error(res, result); }
  catch (error) { return database_error(res, error); }
});

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

  const { expected_version, reason } = req.body ?? {};
  if (!Number.isSafeInteger(expected_version) || expected_version < 1 || typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
    return invalid_request(res, "Provide the current event version and a cancellation reason.");
  }

  try {
    const result = await cancel_event(event_id, req.session.user_id, expected_version, reason.trim());
    if (result.ok) {
      return res.json({
        message: result.already_cancelled ? `${result.event_title} was already cancelled.` : `${result.event_title} was cancelled. Notifications are queued.`,
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
    if (result.reason === "started") {
      return res.status(409).json({ message: "An event cannot be cancelled after it starts." });
    }
    if (result.reason === "stale") return res.status(409).json({ message: "This event has changed. Refresh and try again.", code: "stale" });
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
  if (Object.keys(input).some(key => !["title", "description", "expected_version", "capacity", "visibility", "registration_closes_at"].includes(key))) {
    return invalid_request(res, "Unknown event field.");
  }
  const message = validate_event_details(input);
  if (message) {
    return invalid_request(res, message);
  }

  const { expected_version, capacity, visibility, registration_closes_at } = input;
  if (!Number.isSafeInteger(expected_version) || expected_version < 1 ||
      (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500)) ||
      (visibility !== undefined && !["Public", "Members only"].includes(visibility))) {
    return invalid_request(res, "Provide the current version and valid event details.");
  }
  let deadline;
  if (registration_closes_at !== undefined) {
    deadline = utc_to_campus_datetime(registration_closes_at);
    if (!deadline) {
      return invalid_request(res, "Registration deadline must be a UTC ISO timestamp.");
    }
  }

  const { title, description } = input;
  const result = await edit_event(
    event_id,
    {
      title,
      description,
      visibility,
      capacity,
      registration_closes_at: deadline,
      expected_version,
    },
    req.session.user_id,
  );

  if (result.ok) {
    return res.json({ message: "Event details updated. Notifications are queued." });
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
  if (result.reason === "frozen") {
    return res.status(409).json({ message: "Published event scheduling and eligibility fields cannot be changed." });
  }
  if (result.reason === "stale") return res.status(409).json({ message: "This event has changed. Refresh and try again.", code: "stale" });
  if (result.reason === "invalid_details") return invalid_request(res, "Capacity or registration deadline is invalid.");
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
      return res.status(result.unchanged ? 200 : result.status === "waitlisted" ? 202 : 201).json({
        status: result.status,
        unchanged: Boolean(result.unchanged),
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
    if (result.reason === "full") {
      return res.status(409).json({ message: "This event is full. Refresh to join its waitlist." });
    }
    if (result.reason === "waitlist_full") {
      return res.status(409).json({ message: "This event's waitlist is full." });
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
    if (result.reason === "started") {
      return res.status(409).json({ message: "Participation cannot be changed after the event starts." });
    }
    if (result.reason === "database") {
      return database_error(res, result.error);
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

  const { club, title, description, date, venue, timeslot, visibility, capacity, registration_closes_at } =
    req.body;
  const bounds = timeslot_bounds(date, timeslot);
  if (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500)) return invalid_request(res, "Capacity must be between 1 and 500.");
  const deadline = registration_closes_at === undefined ? undefined : utc_to_campus_datetime(registration_closes_at);
  if (registration_closes_at !== undefined && !deadline) return invalid_request(res, "Registration deadline must be a real UTC ISO timestamp.");

  const result = await create_event({
    club,
    title,
    description,
    date,
    venue,
    timeslot,
    visibility,
    bounds,
    capacity,
    registration_closes_at: deadline,
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
