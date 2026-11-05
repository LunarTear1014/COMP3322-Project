import { Router } from "express";
import {
  current_account_handler,
  login_handler,
  logout_handler,
  register_handler,
  show_current_user,
  update_current_user_handler,
} from "./users.controller.js";

const router = Router();

router.post("/api/auth/register", register_handler);
router.post("/api/auth/login", login_handler);
router.post("/api/auth/logout", logout_handler);
router.get("/api/auth/me", current_account_handler);

// The demo user is used until the login feature supplies an authenticated user id.
router.get("/api/user/me", show_current_user);
router.put("/api/user/me", update_current_user_handler);

export default router;
