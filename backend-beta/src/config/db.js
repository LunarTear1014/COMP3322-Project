import dotenv from "dotenv";
import mysql from "mysql2/promise";

// Local Node runs read code/.env.
dotenv.config({ path: new URL("../.env", import.meta.url) });

const required_values = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const missing_values = required_values.filter((name) => !process.env[name]);

if (missing_values.length > 0) {
  throw new Error(
    `Missing database configuration: ${missing_values.join(", ")}. ` +
      "Copy .env.example to .env and fill in the values."
  );
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

export default pool;
