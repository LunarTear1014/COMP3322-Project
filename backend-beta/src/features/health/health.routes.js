import { Router } from "express";
import pool from "../../config/db.js";

const router = Router();

// A quick way to check that the API can talk to MySQL.
router.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

export default router;
