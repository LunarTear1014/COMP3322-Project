import { Router } from "express";
import { invalid_request, database_error } from "../../shared/http.js";
import { TIMESLOTS, today, timeslot_bounds } from "../../shared/timeslots.js";
import { list_venues_with_availability } from "./venues.service.js";

const router = Router();

// GET /api/venues?date=2026-10-06
router.get("/api/venues", async (req, res) => {
  const date = req.query.date || today();
  if (!timeslot_bounds(date, TIMESLOTS[0])) {
    return invalid_request(res, "Date must be a real date in YYYY-MM-DD format");
  }

  try {
    res.json(await list_venues_with_availability(date));
  } catch (error) {
    database_error(res, error);
  }
});

export default router;
