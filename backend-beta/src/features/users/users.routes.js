import { Router } from "express";
import {
  current_account_handler,
  login_handler,
  logout_handler,
  register_handler,
} from "./users.controller.js";

const router = Router();

router.post("/api/auth/register", register_handler);
router.post("/api/auth/login", login_handler);
router.post("/api/auth/logout", logout_handler);
router.get("/api/auth/me", current_account_handler);

export default router;
