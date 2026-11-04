import { Router } from "express";
import { invalid_request, database_error } from "../../shared/http.js";
import { get_profile, update_profile } from "./profile.service.js";

const router = Router();

// The demo user is used until the login feature supplies an authenticated user id.
router.get("/api/profile", async (_req, res) => {
  try {
    const profile = await get_profile();
    if (!profile) {
      return res.status(404).json({ message: "Demo user was not found." });
    }
    res.json(profile);
  } catch (error) {
    database_error(res, error);
  }
});

router.put("/api/profile", async (req, res) => {
  const { name, email } = req.body;
  if (typeof name !== "string" || name.trim() === "") {
    return invalid_request(res, "Name is required");
  }
  if (typeof email !== "string" || !email.includes("@")) {
    return invalid_request(res, "Enter a valid email address");
  }

  try {
    const result = await update_profile(name, email);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return res.status(404).json({ message: "Demo user was not found." });
      }
      return res
        .status(409)
        .json({ message: "That email address is already in use." });
    }
    res.json(result.profile);
  } catch (error) {
    database_error(res, error);
  }
});

export default router;
