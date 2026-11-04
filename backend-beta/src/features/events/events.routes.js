import { Router } from "express";
import { invalid_request, database_error } from "../../shared/http.js";
import { timeslot_bounds } from "../../shared/timeslots.js";
import { validate_event_input } from "./events.validation.js";
import { list_events, create_event } from "./events.service.js";

const router = Router();

// GET /api/events
router.get("/api/events", async (_req, res) => {
  try {
    res.json(await list_events());
  } catch (error) {
    database_error(res, error);
  }
});

// POST /api/events: book the venue and create the event in one transaction.
router.post("/api/events", async (req, res) => {
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
  });

  if (result.ok) {
    return res.status(201).json(result.event);
  }
  if (result.reason === "conflict") {
    return res.status(409).json({ message: result.message });
  }
  if (result.reason === "database") {
    return database_error(res, result.error);
  }
  return invalid_request(res, result.message);
});

export default router;
