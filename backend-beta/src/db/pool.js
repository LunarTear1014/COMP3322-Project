import mysql from "mysql2/promise";

// Pool for the v1 stack. Every connection runs in UTC so DATETIME(6) columns
// hold UTC by convention (database.md section 1). The legacy beta pool in
// config/db.js keeps its session timezone until the frontend cutover.
function create_utc_pool({ host, port = 3306, database, user, password, connection_limit = 10 }) {
  const pool = mysql.createPool({
    host,
    port,
    database,
    user,
    password,
    waitForConnections: true,
    connectionLimit: connection_limit,
    queueLimit: 0,
    dateStrings: true,
    timezone: "Z",
    // Applied when each physical connection is first opened.
    // (Run through the event hook below.)
  });
  pool.pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return pool;
}

export { create_utc_pool };
