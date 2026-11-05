import pool from "../config/db.js";

const club_name = "Photography Society";
const accounts = [
  {
    email: "member@clubspace.test",
    student_id: "CLUBSPACE-MEMBER",
    name: "ClubSpace Member",
    role: "member",
    password_hash: "3555d60561c0bcf4bb4e1f114023015f:36e8974b28b5baa5f6cd4648c4538418d9e333e77a0a8a83b1ee6098b557c5ffd9e70e0406fe9634d6972c1aa371711ca08c611592672e6ed939ccaafd4e81f7",
  },
  {
    email: "committee@clubspace.test",
    student_id: "CLUBSPACE-COMMITTEE",
    name: "ClubSpace Committee",
    role: "committee",
    password_hash: "4f65c2ce48669d2e5d289c8e87b4f20c:e59a27d0ec6a956742ec5b49691d0cbb998760519ea8e1f2c324516e77383308f51ddf3b4b691bacc37d5b0774c92ef2bbf6da01b2e5a9292207905baaa1429f",
  },
];
let connection;

try {
  connection = await pool.getConnection();
  await connection.beginTransaction();
  const [[club]] = await connection.execute(
    "SELECT id FROM clubs WHERE name = ?",
    [club_name],
  );
  if (!club) throw new Error(`The starter club ${club_name} is missing.`);

  for (const account of accounts) {
    const [[existing]] = await connection.execute(
      "SELECT id, student_id FROM users WHERE email = ? FOR UPDATE",
      [account.email],
    );
    if (existing && existing.student_id !== account.student_id) {
      throw new Error(`Starter account setup conflicts with an existing account for ${account.email}.`);
    }

    let user_id;
    if (existing) {
      user_id = existing.id;
      await connection.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        [account.password_hash, user_id],
      );
    } else {
      const [user] = await connection.execute(
        "INSERT INTO users (email, password_hash, name, student_id) VALUES (?, ?, ?, ?)",
        [account.email, account.password_hash, account.name, account.student_id],
      );
      user_id = user.insertId;
    }

    await connection.execute(
      "INSERT INTO memberships (user_id, club_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = memberships.role",
      [user_id, club.id, account.role],
    );
  }

  await connection.commit();
  console.log("Starter member and committee accounts are ready.");
} catch (error) {
  if (connection) await connection.rollback();
  throw error;
} finally {
  connection?.release();
  await pool.end();
}
