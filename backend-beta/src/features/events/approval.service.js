import pool from "../../config/db.js";
import { enqueueEventJob } from "../../jobs/notifications.js";
import { audit } from "./audit.js";

async function lockWorkflow(connection, bookingId) {
  const [[locator]] = await connection.query("SELECT venue_id,club_id FROM bookings WHERE id=?", [bookingId]);
  if (!locator) return null;
  await connection.query("SELECT id FROM venues WHERE id=? FOR UPDATE", [locator.venue_id]);
  await connection.query("SELECT id FROM clubs WHERE id=? FOR UPDATE", [locator.club_id]);
  const [[booking]] = await connection.query(`SELECT *, start_time > DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AS future
    FROM bookings WHERE id=? FOR UPDATE`, [bookingId]);
  if (!booking || booking.venue_id !== locator.venue_id || booking.club_id !== locator.club_id) throw new Error("Booking relationships changed");
  const [[event]] = await connection.query(`SELECT *, COALESCE(registration_closes_at,start_time) > DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AS open
    FROM events WHERE booking_id=? FOR UPDATE`, [bookingId]);
  if (!event || event.club_id !== booking.club_id) throw new Error("Booking event missing");
  return { booking, event };
}

export async function listPendingBookings(userId) {
  const [[user]] = await pool.query("SELECT platform_role FROM users WHERE id=?", [userId]);
  if (user?.platform_role !== "venue_admin") return { reason: "forbidden" };
  const [rows] = await pool.query(`SELECT b.id,b.club_id,b.venue_id,b.status,b.version,b.requested_by,
    DATE_FORMAT(b.start_time,'%Y-%m-%d %H:%i:%s') AS start_time,
    DATE_FORMAT(b.end_time,'%Y-%m-%d %H:%i:%s') AS end_time,
    b.start_time <= DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AS expired,
    e.id AS event_id,e.title AS event_title FROM bookings b JOIN events e ON e.booking_id=b.id
    WHERE b.status='pending' ORDER BY b.created_at,b.id`);
  return { rows };
}

export async function decideBooking(bookingId, userId, expectedVersion, decision, reason = "") {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const [[user]] = await connection.query("SELECT platform_role FROM users WHERE id=?", [userId]);
    if (user?.platform_role !== "venue_admin") { await connection.rollback(); return { reason: "forbidden" }; }
    const locked = await lockWorkflow(connection, bookingId);
    if (!locked) { await connection.rollback(); return { reason: "not_found" }; }
    const { booking, event } = locked;
    const [[member]] = await connection.query("SELECT role FROM memberships WHERE club_id=? AND user_id=?", [booking.club_id, userId]);
    if (["committee", "president"].includes(member?.role)) { await connection.rollback(); return { reason: "self_decision" }; }
    if (booking.version !== expectedVersion) { await connection.rollback(); return { reason: "stale" }; }
    if (booking.status !== "pending" || event.status !== "draft" || !booking.future) { await connection.rollback(); return { reason: "invalid_state" }; }
    if (decision === "approve") {
      const [[conflict]] = await connection.query(`SELECT id FROM bookings WHERE venue_id=? AND status='confirmed'
        AND id<>? AND start_time<? AND end_time>? LIMIT 1`, [booking.venue_id, booking.id, booking.end_time, booking.start_time]);
      if (conflict) { await connection.rollback(); return { reason: "conflict" }; }
    }
    const status = decision === "approve" ? "confirmed" : "rejected";
    await connection.query(`UPDATE bookings SET status=?,version=version+1,decided_by=?,decided_at=UTC_TIMESTAMP(6),decision_reason=? WHERE id=?`,
      [status, userId, reason || null, booking.id]);
    const [recipients] = await connection.query("SELECT user_id FROM memberships WHERE club_id=? AND role IN ('committee','president')", [booking.club_id]);
    await audit(connection, userId, "booking", booking.id, `booking.${status}`, { event_id: event.id, reason });
    await enqueueEventJob(connection, { type: "booking_decided", eventId: event.id, bookingId: booking.id,
      recipients: recipients.map(row => row.user_id), title: event.title, action: decision === "approve" ? "approved" : "rejected" });
    await connection.commit();
    return { ok: true, booking_id: booking.id, event_id: event.id, status, version: booking.version + 1 };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function publishEvent(eventId, userId, expectedVersion) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const [[locator]] = await connection.query("SELECT booking_id FROM events WHERE id=?", [eventId]);
    if (!locator) { await connection.rollback(); return { reason: "not_found" }; }
    const locked = await lockWorkflow(connection, locator.booking_id);
    if (!locked || locked.event.id !== eventId) throw new Error("Event relationship changed");
    const { booking, event } = locked;
    const [[member]] = await connection.query("SELECT role FROM memberships WHERE club_id=? AND user_id=?", [booking.club_id, userId]);
    if (!["committee", "president"].includes(member?.role)) { await connection.rollback(); return { reason: "forbidden" }; }
    if (event.version !== expectedVersion) { await connection.rollback(); return { reason: "stale" }; }
    if (event.status !== "draft" || booking.status !== "confirmed" || !booking.future || !event.open) {
      await connection.rollback(); return { reason: "invalid_state" };
    }
    await connection.query("UPDATE events SET status='published',version=version+1 WHERE id=?", [event.id]);
    await audit(connection, userId, "event", event.id, "event.published", { booking_id: booking.id });
    await connection.commit();
    return { ok: true, event_id: event.id, version: event.version + 1 };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
