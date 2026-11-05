import { Router } from "express";
import { invalid_request, database_error } from "../../shared/http.js";
import { DATE_FORMAT, today } from "../../shared/timeslots.js";
import { list_venues_with_availability } from "./venues.service.js";

const router = Router();

// GET /api/venues?date=2026-10-06
router.get("/api/venues", async (req, res) => {
  const date = req.query.date || today();
  if (!DATE_FORMAT.test(date)) {
    return invalid_request(res, "Date must look like 2026-10-06");
  }

  try {
    res.json(await list_venues_with_availability(date));
  } catch (error) {
    database_error(res, error);
  }
});

export default router;
