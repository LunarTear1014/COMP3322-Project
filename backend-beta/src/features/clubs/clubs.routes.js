import { Router } from "express";
import { database_error, invalid_request } from "../../shared/http.js";
import {
  join_club,
  leave_club,
  list_clubs,
  list_memberships,
  list_club_members,
  promote_club_member,
  demote_club_member,
  remove_club_member,
  leave_committee,
  create_club,
  transfer_presidency,
  delete_club,
  list_join_requests,
  review_join_request,
  list_club_actions,
  undo_club_action,
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
    res.json(await list_clubs(req.session?.user_id ?? null));
  } catch (error) {
    database_error(res, error);
  }
});

router.get("/api/memberships", async (req, res) => {
  try {
    res.json(await list_memberships(req.session?.user_id ?? null));
  } catch (error) {
    database_error(res, error);
  }
});

router.post("/api/clubs", async (req, res) => {
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Please sign in to create a club." });
  }
  const { name, description = "" } = req.body ?? {};
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    name.trim().length > 255
  ) {
    return invalid_request(res, "Club name is required and must be 255 characters or fewer.");
  }
  if (
    typeof description !== "string" ||
    description.length > 5000
  ) {
    return invalid_request(res, "Club description must be 5000 characters or fewer.");
  }

  try {
    const result = await create_club(
      { name, description },
      req.session.user_id,
    );
    if (!result.ok) {
      return res.status(409).json({ message: "A club with that name already exists." });
    }
    return res.status(201).json(result.club);
  } catch (error) {
    return database_error(res, error);
  }
});

router.post("/api/clubs/:club_id/membership", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Please sign in to request to join a club." });
  }

  try {
    const result = await join_club(club_id, req.session.user_id);
    if (result.ok) {
      return res.status(202).json({
        message: `Your request to join ${result.club_name} was sent to its committee.`,
        status: "pending",
      });
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    if (result.reason === "already_member") {
      return res.status(409).json({ message: "You are already a member of this club." });
    }
    return res.status(409).json({ message: "Your request to join this club is already pending." });
  } catch (error) {
    return database_error(res, error);
  }
});

router.get("/api/clubs/:club_id/join-requests", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Sign in to view club join requests." });
  }

  try {
    const result = await list_join_requests(club_id, req.session.user_id);
    if (result.ok) {
      return res.json(result.requests);
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    return res.status(403).json({ message: "Only committee members or the president can review join requests." });
  } catch (error) {
    return database_error(res, error);
  }
});

router.post(
  "/api/clubs/:club_id/join-requests/:request_id/review",
  async (req, res) => {
    const club_id = parse_club_id(req.params.club_id);
    const request_id = parse_user_id(req.params.request_id);
    if (club_id === null) {
      return invalid_request(res, "Club ID must be a positive integer.");
    }
    if (request_id === null) {
      return invalid_request(res, "Join request ID must be a positive integer.");
    }
    if (!["accept", "reject"].includes(req.body?.decision)) {
      return invalid_request(res, "Choose whether to accept or reject this request.");
    }
    if (!Number.isSafeInteger(req.session?.user_id)) {
      return res.status(401).json({ message: "Sign in to review club join requests." });
    }

    try {
      const result = await review_join_request(
        club_id,
        request_id,
        req.session.user_id,
        req.body.decision,
      );
      if (result.ok) {
        return res.json({
          message:
            result.decision === "accept"
              ? "Join request accepted. The student is now a club member."
              : "Join request rejected.",
        });
      }
      if (result.reason === "not_found") {
        return res.status(404).json({ message: "Club not found." });
      }
      if (result.reason === "forbidden") {
        return res.status(403).json({ message: "Only committee members or the president can review join requests." });
      }
      return res.status(404).json({ message: "This join request is no longer pending." });
    } catch (error) {
      return database_error(res, error);
    }
  },
);

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
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Sign in before leaving a club." });
  }

  try {
    const result = await leave_club(club_id, req.session.user_id);
    if (result.ok) {
      return res.status(204).end();
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    if (result.reason === "president_must_transfer") {
      return res.status(409).json({
        message: "Transfer the presidency or delete the club before leaving.",
      });
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
    return res.status(403).json({ message: "Only committee members or the president can view the club roster." });
  } catch (error) {
    return database_error(res, error);
  }
});

router.get("/api/clubs/:club_id/actions", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Sign in to view the club action log." });
  }
  try {
    const result = await list_club_actions(club_id, req.session.user_id);
    if (result.ok) return res.json(result.actions);
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    return res.status(403).json({ message: "Only the club president can view the action log." });
  } catch (error) {
    return database_error(res, error);
  }
});

router.post("/api/clubs/:club_id/actions/:action_id/undo", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  const action_id = parse_user_id(req.params.action_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (action_id === null) {
    return invalid_request(res, "Action ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Sign in to undo a club action." });
  }
  try {
    const result = await undo_club_action(club_id, action_id, req.session.user_id);
    if (result.ok) return res.json({ message: "Action undone. Affected members have been notified." });
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    if (result.reason === "forbidden") {
      return res.status(403).json({ message: "Only the club president can undo actions." });
    }
    if (result.reason === "action_not_found") {
      return res.status(404).json({ message: "Action not found." });
    }
    if (result.reason === "later_action_exists" || result.reason === "state_changed") {
      return res.status(409).json({ message: "This action can no longer be safely undone because related club data has changed." });
    }
    return res.status(409).json({ message: "This action cannot be undone." });
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
        return res.status(403).json({ message: "Only committee members or the president can promote members." });
      }
      if (result.reason === "cannot_promote_self") {
        return res.status(400).json({ message: "You cannot promote yourself." });
      }
      if (result.reason === "not_a_member") {
        return res.status(404).json({ message: "That user is not a member of this club." });
      }
      return res.status(409).json({ message: "That member already has a committee role." });
    } catch (error) {
      return database_error(res, error);
    }
  },
);

router.delete(
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
      const result = await demote_club_member(
        club_id,
        member_user_id,
        req.session.user_id,
      );
      if (result.ok) {
        return res.json({ message: "Member returned to regular member role." });
      }
      if (result.reason === "not_found") {
        return res.status(404).json({ message: "Club not found." });
      }
      if (result.reason === "forbidden") {
        return res.status(403).json({ message: "Only the president can remove a committee role." });
      }
      if (result.reason === "cannot_demote_self") {
        return res.status(400).json({ message: "You cannot demote yourself." });
      }
      if (result.reason === "not_a_member") {
        return res.status(404).json({ message: "That user is not a member of this club." });
      }
      return res.status(409).json({ message: "That member is not on the committee." });
    } catch (error) {
      return database_error(res, error);
    }
  },
);

router.delete(
  "/api/clubs/:club_id/members/:user_id",
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
      return res.status(401).json({ message: "Log in to remove club members." });
    }

    try {
      const result = await remove_club_member(
        club_id,
        member_user_id,
        req.session.user_id,
      );
      if (result.ok) {
        return res.json({ message: "Member removed from the club." });
      }
      if (result.reason === "not_found") {
        return res.status(404).json({ message: "Club not found." });
      }
      if (result.reason === "forbidden") {
        return res.status(403).json({ message: "Only committee members or the president can remove club members." });
      }
      if (result.reason === "cannot_remove_self") {
        return res.status(400).json({ message: "You cannot remove yourself from the club." });
      }
      if (result.reason === "not_a_member") {
        return res.status(404).json({ message: "That user is not a member of this club." });
      }
      return res.status(409).json({ message: "Only regular members can be removed. Demote committee members first." });
    } catch (error) {
      return database_error(res, error);
    }
  },
);

router.post("/api/clubs/:club_id/presidency", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  const target_user_id = parse_user_id(req.body?.user_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (target_user_id === null) {
    return invalid_request(res, "Choose a committee member to become president.");
  }
  if (
    typeof req.body?.confirmation !== "string" ||
    req.body.confirmation.trim() === ""
  ) {
    return invalid_request(res, "Enter the club name to confirm the presidency transfer.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Log in to transfer the presidency." });
  }

  try {
    const result = await transfer_presidency(
      club_id,
      target_user_id,
      req.session.user_id,
      req.body.confirmation,
    );
    if (result.ok) {
      return res.json({ message: "Presidency transferred." });
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    if (result.reason === "forbidden") {
      return res.status(403).json({ message: "Only the club president can transfer the presidency." });
    }
    if (result.reason === "target_not_committee") {
      return res.status(409).json({ message: "The new president must already be a committee member." });
    }
    if (result.reason === "cannot_transfer_to_self") {
      return res.status(400).json({ message: "Choose another committee member." });
    }
    return res.status(422).json({
      message: "The club name you entered is incorrect. Please type the exact club name.",
    });
  } catch (error) {
    return database_error(res, error);
  }
});

router.delete("/api/clubs/:club_id", async (req, res) => {
  const club_id = parse_club_id(req.params.club_id);
  if (club_id === null) {
    return invalid_request(res, "Club ID must be a positive integer.");
  }
  if (
    typeof req.body?.confirmation !== "string" ||
    req.body.confirmation.trim() === ""
  ) {
    return invalid_request(res, "Enter the club name to confirm deletion.");
  }
  if (!Number.isSafeInteger(req.session?.user_id)) {
    return res.status(401).json({ message: "Log in to delete a club." });
  }

  try {
    const result = await delete_club(
      club_id,
      req.session.user_id,
      req.body.confirmation,
    );
    if (result.ok) {
      return res.status(204).end();
    }
    if (result.reason === "not_found") {
      return res.status(404).json({ message: "Club not found." });
    }
    if (result.reason === "forbidden") {
      return res.status(403).json({ message: "Only the club president can delete the club." });
    }
    return res.status(422).json({
      message: "The club name you entered is incorrect. Please type the exact club name.",
    });
  } catch (error) {
    return database_error(res, error);
  }
});

export default router;
