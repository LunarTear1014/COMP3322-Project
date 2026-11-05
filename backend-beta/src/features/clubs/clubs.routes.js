import { Router } from "express";
import { database_error, invalid_request } from "../../shared/http.js";
import {
  join_club,
  leave_club,
  list_clubs,
  list_memberships,
} from "./clubs.service.js";

const router = Router();

function parse_club_id(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const club_id = Number(value);
  return Number.isSafeInteger(club_id) ? club_id : null;
}

router.get("/api/clubs", async (req, res) => {
  try {
    res.json(await list_clubs(req.session?.user_id));
  } catch (error) {
    database_error(res, error);
  }
});

router.get("/api/memberships", async (req, res) => {
  try {
    res.json(await list_memberships(req.session?.user_id));
  } catch (error) {
    database_error(res, error);
  }
});

router.post("/api/clubs/:club_id/membership", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }

  try {
    const result = await join_club(club_id, req.session?.user_id);
    if (result.ok) {
      return res.status(201).json(result.membership);
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    return res.status(409).json({ message: "You already joined this club." });
  } catch (error) {
    return database_error(res, error);
  }
});

router.delete("/api/clubs/:club_id/membership", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }

  try {
    const result = await leave_club(club_id, req.session?.user_id);
    if (result.ok) {
      return res.status(204).end();
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    return res.status(409).json({ message: "You have not joined this club." });
  } catch (error) {
    return database_error(res, error);
  }
});

export default router;
