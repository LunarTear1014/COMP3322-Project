import { Router } from "express";
import { database_error, invalid_request } from "../../shared/http.js";
import {
  join_club,
  leave_club,
  list_clubs,
  list_memberships,
  list_club_members,
  promote_club_member,
  leave_committee,
} from "./clubs.service.js";

const router = Router();

function parse_club_id(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const club_id = Number(value);
  return Number.isSafeInteger(club_id) ? club_id : null;
}

function parse_user_id(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const user_id = Number(value);
  return Number.isSafeInteger(user_id) ? user_id : null;
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

router.delete("/api/clubs/:club_id/committee", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Log in to leave a committee." });
  }

  try {
    const result = await leave_committee(club_id, req.session.user_id);
    if (result.ok) {
      return res.json({ message: "You are now a regular club member." });
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    if (result.reason === "not_a_member") {
      return res.status(404).json({ message: "You are not a member of this club." });
    }
    return res.status(409).json({ message: "You are not on this club's committee." });
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

router.get("/api/clubs/:club_id/members", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Log in to manage committee roles." });
  }

  try {
    const result = await list_club_members(club_id, req.session.user_id);
    if (result.ok) {
      return res.json(result.members);
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    return res.status(403).json({ message: "Only committee members can view the club roster." });
  } catch (error) {
    return database_error(res, error);
  }
});

router.post(
  "/api/clubs/:club_id/members/:user_id/committee",
  async (req, res) => {
    const club_id = parse_club_id(req.params.club_id);
    const member_user_id = parse_user_id(req.params.user_id);
    if (club_id === null) {
      return invalid_request(res, "Club ID must be a positive integer.");
    }
    if (member_user_id === null) {
      return invalid_request(res, "User ID must be a positive integer.");
    }
    if (!Number.isSafeInteger(req.session?.user_id)) {
      return res.status(401).json({ message: "Log in to manage committee roles." });
    }

    try {
      const result = await promote_club_member(
        club_id,
        member_user_id,
        req.session.user_id,
      );
      if (result.ok) {
        return res.json({ message: "Member promoted to committee." });
      }
      if (result.reason === "not_found") {
        return res.status(404).json({ message: "Club not found." });
      }
      if (result.reason === "forbidden") {
        return res.status(403).json({ message: "Only committee members can promote members." });
      }
      if (result.reason === "cannot_promote_self") {
        return res.status(400).json({ message: "You cannot promote yourself." });
      }
      if (result.reason === "not_a_member") {
        return res.status(404).json({ message: "That user is not a member of this club." });
      }
      return res.status(409).json({ message: "That member is already on the committee." });
    } catch (error) {
      return database_error(res, error);
    }
  },
);

export default router;
