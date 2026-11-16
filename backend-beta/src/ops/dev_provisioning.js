import { randomBytes } from "node:crypto";
import { create_password_hasher } from "../features/users/password_hasher.js";

// Development provisioning (task 2.7). No fixed credentials live in the repo:
// the password comes from DEV_ACCOUNT_PASSWORD or is generated per run, hashed
// with the v1 hasher, and never committed. Accounts use .example addresses.
//
// First presidents (product-owner decision 2026-11-16): each club without a
// president gets a fictional student as president. Nothing is inferred from
// existing committee members.

// Fictional, plausible Hong Kong student names (no real people).
const PRESIDENT_NAMES = {
  "Photography Society": "Chan Hiu Tung",
  "Film Society": "Leung Ka Ho",
  "Debate Club": "Wong Tsz Yan",
  "Chess & Strategy": "Lam Man Kit",
  "Hiking Club": "Cheung Yuk Ching",
  "Robotics Lab": "Ng Chun Wai",
};
const FALLBACK_NAMES = ["Lau Wing Sze", "Tse Ho Yin", "Yip Sin Yi", "Fung Kai Chung", "Mak Hoi Ying", "Poon Chi Hang"];

const president_name = (club) => PRESIDENT_NAMES[club.name] ?? FALLBACK_NAMES[club.id % FALLBACK_NAMES.length];

function generated_password() {
  return randomBytes(18).toString("base64url");
}

// Returns [{ club, name, email, student_id, created }]. Idempotent: a club that
// already has a president is skipped, and an existing account is reused.
async function provision_presidents(pool, { password, hasher = create_password_hasher() } = {}) {
  const password_hash = await hasher.hash(password ?? generated_password());
  const conn = await pool.getConnection();
  const result = [];
  try {
    await conn.beginTransaction();
    const [clubs] = await conn.query("SELECT id, name FROM clubs ORDER BY id FOR UPDATE");
    for (const club of clubs) {
      const [[has]] = await conn.query("SELECT COUNT(*) AS n FROM memberships WHERE club_id = ? AND role = 'president'", [club.id]);
      if (Number(has.n) > 0) continue;
      const name = president_name(club);
      const email = `president.club${club.id}@clubspace.example`;
      const student_id = `PRES-${String(club.id).padStart(3, "0")}`;
      let [[user]] = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
      if (!user) {
        const [insert] = await conn.query("INSERT INTO users (email, password_hash, name, student_id) VALUES (?, ?, ?, ?)", [email, password_hash, name, student_id]);
        user = { id: insert.insertId };
      }
      // Promote the dedicated president account (adds or upgrades its membership).
      await conn.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, 'president') ON DUPLICATE KEY UPDATE role = 'president', version = version + 1", [user.id, club.id]);
      result.push({ club: club.name, name, email, student_id });
    }
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// A development venue administrator. Refuses to run in production.
async function provision_admin(pool, { password, hasher = create_password_hasher(), env = process.env } = {}) {
  if (env.NODE_ENV === "production") throw new Error("Do not provision a development administrator in production.");
  const password_hash = await hasher.hash(password ?? generated_password());
  await pool.query(
    `INSERT INTO users (email, password_hash, name, student_id, platform_role) VALUES ('admin@clubspace.example', ?, 'Venue Administrator', 'ADMIN-001', 'venue_admin')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), platform_role = 'venue_admin'`, [password_hash]);
  return { email: "admin@clubspace.example" };
}

export { PRESIDENT_NAMES, generated_password, president_name, provision_admin, provision_presidents };
