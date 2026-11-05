import { Router } from "express";
import {
  show_current_user,
  update_current_user_handler,
} from "./users.controller.js";

const router = Router();

// The demo user is used until the login feature supplies an authenticated user id.
router.get("/api/user/me", show_current_user);
router.put("/api/user/me", update_current_user_handler);

export default router;
