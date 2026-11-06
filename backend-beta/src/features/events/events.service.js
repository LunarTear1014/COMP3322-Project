import pool from "../../config/db.js";
import { today } from "../../shared/timeslots.js";
import { enqueueEventJob } from "../../jobs/notifications.js";
import { recordParticipation, recordCancellation } from "./history.js";
import { audit } from "./audit.js";

function display_visibility(visibility) {
  return visibility === "members_only" ? "Members only" : "Public";
}

function database_visibility(visibility) {
  return visibility === "Members only" ? "members_only" : "public";
}

function make_timeslot(start_time, end_time) {
  return `${start_time.slice(0, 5)} - ${end_time.slice(0, 5)}`;
}

function event_response(row) {
  return {
    id: row.id,
    title: row.title,
    club: row.club,
    date: row.date,
    timeslot: make_timeslot(row.start_time, row.end_time),
    venue: row.venue,
    description: row.description,
    visibility: display_visibility(row.visibility),
    joined_count: Number(row.joined_count),
    capacity: Number(row.capacity),
    is_full: Number(row.joined_count) >= Number(row.capacity),
    is_joined: Boolean(row.is_joined),
    participation_status: row.participation_status === "left" ? null : row.participation_status,
    registration_status: row.participation_status,
    waitlisted_count: Number(row.waitlisted_count),
    event_status: row.event_status,
    version: row.version,
    booking_status: row.booking_status,
    booking_id: row.booking_id,
    booking_version: row.booking_version,
    decision_reason: row.decision_reason,
    registration_closes_at: row.registration_closes_at,
    club_id: row.club_id,
    venue_id: row.venue_id,
    can_cancel: Boolean(row.can_cancel),
    status: row.date >= today() ? "Upcoming" : "Past",
  };
}

async function list_events(user_id = null, { event_id = null, managed = false } = {}) {
  const organizer = "manager.role IN ('committee', 'president')";
  let visibility = "e.status = 'published'";
  const parameters = [user_id, user_id, user_id];
  if (managed) {
    visibility = organizer;
  } else if (event_id !== null) {
    visibility = `e.id = ? AND (e.status = 'published' OR ${organizer} OR EXISTS (
      SELECT 1 FROM participations p WHERE p.event_id = e.id AND p.user_id = ?
    ) OR EXISTS (SELECT 1 FROM users admin WHERE admin.id = ? AND admin.platform_role = 'venue_admin'))`;
    parameters.push(event_id, user_id, user_id);
  }
  const [rows] = await pool.query(`
      SELECT
        e.id,
        e.title,
        e.description,
        DATE_FORMAT(e.start_time, '%Y-%m-%d') AS date,
        TIME_FORMAT(e.start_time, '%H:%i') AS start_time,
        TIME_FORMAT(e.end_time, '%H:%i') AS end_time,
        e.visibility,
        e.capacity,
        e.status AS event_status,
        e.version,
        DATE_FORMAT(e.registration_closes_at, '%Y-%m-%d %H:%i:%s') AS registration_closes_at,
        b.status AS booking_status,
        b.id AS booking_id,
        b.version AS booking_version,
        CASE WHEN ${organizer} THEN b.decision_reason ELSE NULL END AS decision_reason,
        c.id AS club_id,
        v.id AS venue_id,
        c.name AS club,
        v.name AS venue,
        (SELECT COUNT(*)
         FROM participations p
         WHERE p.event_id = e.id AND p.status = 'joined') AS joined_count,
        (SELECT COUNT(*) FROM participations p
         WHERE p.event_id = e.id AND p.status = 'waitlisted') AS waitlisted_count,
        EXISTS(
          SELECT 1
          FROM participations mine
          WHERE mine.event_id = e.id AND mine.user_id = ? AND mine.status = 'joined'
        ) AS is_joined,
        (SELECT mine.status
         FROM participations mine
         WHERE mine.event_id = e.id AND mine.user_id = ?
         LIMIT 1) AS participation_status,
        COALESCE(${organizer}, 0) AS can_cancel
      FROM events e
      JOIN clubs c ON c.id = e.club_id
      JOIN bookings b ON b.id = e.booking_id
      JOIN venues v ON v.id = b.venue_id
      LEFT JOIN memberships manager ON manager.club_id = e.club_id AND manager.user_id = ?
      WHERE ${visibility}
      ORDER BY e.start_time ASC, e.id ASC
    `, parameters);
  return rows.map(event_response);
}

async function list_my_participations(user_id) {
  const [rows] = await pool.query(
    `SELECT
       e.id AS event_id,
       e.title,
       e.description,
       DATE_FORMAT(e.start_time, '%Y-%m-%d') AS date,
       TIME_FORMAT(e.start_time, '%H:%i') AS start_time,
       TIME_FORMAT(e.end_time, '%H:%i') AS end_time,
       e.status AS event_status,
       e.visibility,
       c.name AS club,
       v.name AS venue,
       p.status AS participation_status,
       p.joined_at,
       p.left_at
     FROM participations p
     JOIN events e ON e.id = p.event_id
     JOIN clubs c ON c.id = e.club_id
     JOIN bookings b ON b.id = e.booking_id
     JOIN venues v ON v.id = b.venue_id
     WHERE p.user_id = ?
     ORDER BY e.start_time DESC, e.id DESC`,
    [user_id],
  );

  return rows.map((row) => ({
    id: row.event_id,
    title: row.title,
    description: row.description,
    club: row.club,
    date: row.date,
    timeslot: make_timeslot(row.start_time, row.end_time),
    venue: row.venue,
    visibility: display_visibility(row.visibility),
    event_status: row.event_status,
    participation_status: row.participation_status,
    joined_at: row.joined_at,
    left_at: row.left_at,
    status: row.date >= today() ? "Upcoming" : "Past",
  }));
}

async function list_event_participants(event_id, user_id) {
  const [[event]] = await pool.query(
    "SELECT id, club_id FROM events WHERE id = ?",
    [event_id],
  );
  if (!event) {
    return { ok: false, reason: "not_found" };
  }

  const [[membership]] = await pool.query(
    `SELECT role FROM memberships
     WHERE user_id = ? AND club_id = ?`,
    [user_id, event.club_id],
  );
  if (!["committee", "president"].includes(membership?.role)) {
    return { ok: false, reason: "forbidden" };
  }

  const [participants] = await pool.query(
    `SELECT u.id AS user_id, u.name, p.status, p.joined_at
     FROM participations p
     JOIN users u ON u.id = p.user_id
     WHERE p.event_id = ? AND p.status IN ('joined', 'waitlisted')
     ORDER BY CASE p.status WHEN 'joined' THEN 0 ELSE 1 END,
       p.joined_at ASC, u.name ASC`,
    [event_id],
  );
  return { ok: true, participants };
}

async function promote_locked(connection, event, actor_id, available) {
  const promoted = [];
  while (promoted.length < available) {
    const [[next]] = await connection.query(`SELECT user_id FROM participations
      WHERE event_id=? AND status='waitlisted' ORDER BY COALESCE(queued_at,joined_at),user_id LIMIT 1 FOR UPDATE`, [event.id]);
    if (!next) break;
    if (event.visibility === "members_only") {
      const [[eligible]] = await connection.query("SELECT user_id FROM memberships WHERE user_id=? AND club_id=?", [next.user_id, event.club_id]);
      if (!eligible) {
        await connection.query("UPDATE participations SET status='left',left_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND event_id=?", [next.user_id, event.id]);
        await recordParticipation(connection, { eventId: event.id, userId: next.user_id, actorId: actor_id, action: "left", fromStatus: "waitlisted", toStatus: "left", reason: "membership_ineligible" });
        continue;
      }
    }
    await connection.query("UPDATE participations SET status='joined',confirmed_at=CURRENT_TIMESTAMP(6),left_at=NULL WHERE user_id=? AND event_id=?", [next.user_id, event.id]);
    await recordParticipation(connection, { eventId: event.id, userId: next.user_id, actorId: actor_id, action: "promoted", fromStatus: "waitlisted", toStatus: "joined" });
    await enqueueEventJob(connection, { type: "registration_changed", eventId: event.id, recipients: [next.user_id], title: event.title, action: "promoted" });
    if (event.within_day) await enqueueEventJob(connection, { type: "event_reminder", eventId: event.id, recipients: [next.user_id], title: event.title });
    promoted.push(next.user_id);
  }
  return promoted;
}

async function join_event(event_id, user_id, allow_waitlist = true, reviewer_id = null) {
  if (!Number.isSafeInteger(user_id)) {
    return { ok: false, reason: "unauthenticated" };
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();

    const [[locator]] = await connection.query("SELECT club_id FROM events WHERE id=?", [event_id]);
    if (!locator) { await connection.rollback(); return { ok: false, reason: "not_found" }; }
    await connection.query("SELECT id FROM clubs WHERE id=? FOR UPDATE", [locator.club_id]);

    const [[event]] = await connection.query(
      `SELECT e.id, e.club_id, e.visibility, e.status, e.capacity, e.title,
         e.start_time <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR) AS started,
         e.start_time <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 32 HOUR) AS within_day,
         COALESCE(e.registration_closes_at,e.start_time) > DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AS registration_open,
         (SELECT b.status FROM bookings b WHERE b.id = e.booking_id) AS booking_status
       FROM events e WHERE e.id = ? FOR UPDATE`,
      [event_id],
    );
    if (!event || event.club_id !== locator.club_id) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }
    if (event.status !== "published" || event.booking_status !== "confirmed" || event.started || !event.registration_open) {
      await connection.rollback();
      return { ok: false, reason: "unavailable" };
    }

    if (event.visibility === "members_only") {
      const [[membership]] = await connection.query(
        "SELECT user_id FROM memberships WHERE user_id = ? AND club_id = ?",
        [user_id, event.club_id],
      );
      if (!membership) {
        await connection.rollback();
        return { ok: false, reason: "membership_required" };
      }
    }

    if (reviewer_id !== null) {
      const [[reviewer]] = await connection.query("SELECT role FROM memberships WHERE user_id=? AND club_id=?",[reviewer_id,event.club_id]);
      if (!["committee","president"].includes(reviewer?.role)) { await connection.rollback(); return {ok:false,reason:"forbidden"}; }
      const [[pending]] = await connection.query("SELECT allow_waitlist FROM event_join_requests WHERE event_id=? AND user_id=? AND status='pending' FOR UPDATE",[event_id,user_id]);
      if (!pending || event.visibility !== 'members_only') { await connection.rollback(); return {ok:false,reason:"request_not_found"}; }
      allow_waitlist = Boolean(pending.allow_waitlist);
      await connection.query("UPDATE event_join_requests SET status='accepted',reviewed_by=?,reviewed_at=UTC_TIMESTAMP(6) WHERE event_id=? AND user_id=?",[reviewer_id,event_id,user_id]);
    }

    const [[participation]] = await connection.query(
      "SELECT status FROM participations WHERE user_id = ? AND event_id = ? FOR UPDATE",
      [user_id, event_id],
    );
    if (participation?.status === "joined") {
      await connection.rollback();
      return reviewer_id !== null ? {ok:false,reason:'request_not_found'} : { ok: true, status: "joined", unchanged: true };
    }
    if (participation?.status === "waitlisted") {
      await connection.rollback();
      return reviewer_id !== null ? {ok:false,reason:'request_not_found'} : { ok: true, status: "waitlisted", unchanged: true };
    }
    if (event.visibility === 'members_only' && reviewer_id === null) {
      const [[pending]] = await connection.query("SELECT status FROM event_join_requests WHERE event_id=? AND user_id=? FOR UPDATE",[event_id,user_id]);
      if (pending?.status === 'pending') { await connection.rollback(); return {ok:true,status:'pending',unchanged:true}; }
      await connection.query(`INSERT INTO event_join_requests (event_id,user_id,status,allow_waitlist,requested_at)
        VALUES (?,?,'pending',?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE status='pending',allow_waitlist=VALUES(allow_waitlist),requested_at=VALUES(requested_at),reviewed_by=NULL,reviewed_at=NULL`,[event_id,user_id,allow_waitlist]);
      await connection.commit();
      return {ok:true,status:'pending'};
    }
    const [[signup_count]] = await connection.query(
      `SELECT COUNT(*) AS joined_count
       FROM participations
       WHERE event_id = ? AND status = 'joined'`,
      [event_id],
    );
    const promoted = await promote_locked(connection, event, user_id,
      Math.max(0, Number(event.capacity) - Number(signup_count.joined_count)));
    if (Number(signup_count.joined_count) + promoted.length >= Number(event.capacity)) {
      if (!allow_waitlist) {
        if (reviewer_id !== null) await connection.rollback(); else await connection.commit();
        return { ok: false, reason: "full" };
      }
      const [[waiting]] = await connection.query("SELECT COUNT(*) AS count FROM participations WHERE event_id=? AND status='waitlisted'", [event_id]);
      if (Number(waiting.count) >= 500) { if (reviewer_id !== null) await connection.rollback(); else await connection.commit(); return { ok: false, reason: "waitlist_full" }; }
      if (participation) {
        await connection.query(
          `UPDATE participations
           SET status = 'waitlisted', joined_at = CURRENT_TIMESTAMP(6), last_registered_at=CURRENT_TIMESTAMP(6),
             queued_at=CURRENT_TIMESTAMP(6), confirmed_at=NULL, left_at = NULL
           WHERE user_id = ? AND event_id = ?`,
          [user_id, event_id],
        );
      } else {
        await connection.query(
          "INSERT INTO participations (user_id, event_id, status,last_registered_at,queued_at) VALUES (?, ?, 'waitlisted',CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))",
          [user_id, event_id],
        );
      }
      await recordParticipation(connection, { eventId: event_id, userId: user_id, actorId: user_id, action: "waitlisted", fromStatus: participation?.status, toStatus: "waitlisted" });
      await enqueueEventJob(connection, { type: "registration_changed", eventId: event_id, recipients: [user_id], title: event.title, action: "waitlisted" });
      await connection.commit();
      return { ok: true, status: "waitlisted" };
    }
    if (participation) {
      await connection.query(
        `UPDATE participations
         SET status = 'joined', joined_at = CURRENT_TIMESTAMP(6),last_registered_at=CURRENT_TIMESTAMP(6),
           queued_at=NULL,confirmed_at=CURRENT_TIMESTAMP(6),left_at = NULL
         WHERE user_id = ? AND event_id = ?`,
        [user_id, event_id],
      );
    } else {
      await connection.query(
        "INSERT INTO participations (user_id,event_id,last_registered_at,confirmed_at) VALUES (?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))",
        [user_id, event_id],
      );
    }

    await recordParticipation(connection, { eventId: event_id, userId: user_id, actorId: user_id, action: "joined", fromStatus: participation?.status, toStatus: "joined" });
    await enqueueEventJob(connection, { type: "registration_changed", eventId: event_id, recipients: [user_id], title: event.title, action: "joined" });
    if (event.within_day) {
      await enqueueEventJob(connection, { type: "event_reminder", eventId: event_id, recipients: [user_id], title: event.title });
    }
    await connection.commit();
    return { ok: true, status: "joined" };
  } catch (error) {
    if (connection) await connection.rollback();
    return { ok: false, reason: "database", error };
  } finally {
    if (connection) connection.release();
  }
}

async function reject_event_request(event_id, user_id, reviewer_id) {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    const [[locator]] = await connection.query('SELECT club_id FROM events WHERE id=?',[event_id]);
    if (!locator) { await connection.rollback(); return {ok:false,reason:'not_found'}; }
    await connection.query('SELECT id FROM clubs WHERE id=? FOR UPDATE',[locator.club_id]);
    const [[event]] = await connection.query('SELECT id,club_id,title FROM events WHERE id=? FOR UPDATE',[event_id]);
    const [[reviewer]] = await connection.query('SELECT role FROM memberships WHERE user_id=? AND club_id=?',[reviewer_id,locator.club_id]);
    if (!['committee','president'].includes(reviewer?.role)) { await connection.rollback(); return {ok:false,reason:'forbidden'}; }
    const [result] = await connection.query("UPDATE event_join_requests SET status='rejected',reviewed_by=?,reviewed_at=UTC_TIMESTAMP(6) WHERE event_id=? AND user_id=? AND status='pending'",[reviewer_id,event_id,user_id]);
    if (!result.affectedRows) { await connection.rollback(); return {ok:false,reason:'request_not_found'}; }
    await enqueueEventJob(connection,{type:'registration_changed',eventId:event_id,recipients:[user_id],title:event.title,action:'rejected'});
    await connection.commit();
    return {ok:true,status:'rejected'};
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function leave_event(event_id, user_id) {
  if (!Number.isSafeInteger(user_id)) {
    return { ok: false, reason: "unauthenticated" };
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const [[locator]] = await connection.query("SELECT club_id FROM events WHERE id=?", [event_id]);
    if (!locator) { await connection.rollback(); return { ok: false, reason: "not_found" }; }
    await connection.query("SELECT id FROM clubs WHERE id=? FOR UPDATE", [locator.club_id]);
    const [[event]] = await connection.query(
      `SELECT id, club_id, title, visibility, status, start_time <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR) AS started,
         COALESCE(registration_closes_at,start_time) > DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AS registration_open,
         start_time <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 32 HOUR) AS within_day
       FROM events WHERE id = ? FOR UPDATE`,
      [event_id],
    );
    if (!event || event.club_id !== locator.club_id) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }

    if (event.status === "cancelled") {
      await connection.rollback();
      return { ok: true, cancelled: true };
    }
    const [[participation]] = await connection.query(
      `SELECT status FROM participations
       WHERE user_id = ? AND event_id = ? FOR UPDATE`,
      [user_id, event_id],
    );
    if (!participation || !['joined','waitlisted'].includes(participation.status)) {
      const [pending] = await connection.query("UPDATE event_join_requests SET status='withdrawn' WHERE event_id=? AND user_id=? AND status='pending'",[event_id,user_id]);
      if (pending.affectedRows) { await connection.commit(); return {ok:true,status:'left'}; }
    }
    if (
      !participation ||
      !["joined", "waitlisted"].includes(participation.status)
    ) {
      await connection.rollback();
      return { ok: true, unchanged: true };
    }
    if (event.started) {
      await connection.rollback();
      return { ok: false, reason: "started" };
    }

    await connection.query(
      `UPDATE participations
       SET status = 'left', left_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND event_id = ?`,
      [user_id, event_id],
    );

    await recordParticipation(connection, { eventId: event_id, userId: user_id, actorId: user_id, action: "left", fromStatus: participation.status, toStatus: "left" });
    await enqueueEventJob(connection, { type: "registration_changed", eventId: event_id, recipients: [user_id], title: event.title, action: "left" });

    let promoted_user_id = null;
    if (participation.status === "joined" && event.status === "published" && event.registration_open) {
      [promoted_user_id = null] = await promote_locked(connection, event, user_id, 1);
    }

    await connection.commit();
    return { ok: true, promoted_user_id };
  } catch (error) {
    if (connection) await connection.rollback();
    return { ok: false, reason: "database", error };
  } finally {
    if (connection) connection.release();
  }
}

async function cancel_event(event_id, user_id, expected_version, reason) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();

    // Locate the immutable parents first, then lock in the documented order.
    const [[locator]] = await connection.query(
      `SELECT e.booking_id, e.club_id, b.venue_id
       FROM events e JOIN bookings b ON b.id = e.booking_id WHERE e.id = ?`,
      [event_id],
    );
    if (!locator) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }

    await connection.query("SELECT id FROM venues WHERE id = ? FOR UPDATE", [locator.venue_id]);
    await connection.query("SELECT id FROM clubs WHERE id = ? FOR UPDATE", [locator.club_id]);
    const [[booking]] = await connection.query("SELECT id, venue_id, club_id FROM bookings WHERE id = ? FOR UPDATE", [locator.booking_id]);
    const [[event]] = await connection.query(
      `SELECT id, booking_id, club_id, title, status,version,
         start_time <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR) AS started
       FROM events WHERE id = ? FOR UPDATE`,
      [event_id],
    );
    if (!event || !booking || event.booking_id !== locator.booking_id ||
        event.club_id !== locator.club_id || booking.venue_id !== locator.venue_id ||
        booking.club_id !== locator.club_id) {
      throw new Error("Event relationships changed while acquiring locks");
    }

    const [[membership]] = await connection.query(
      `SELECT role FROM memberships
       WHERE user_id = ? AND club_id = ? FOR UPDATE`,
      [user_id, event.club_id],
    );
    const [[actor]] = await connection.query("SELECT platform_role FROM users WHERE id=?", [user_id]);
    if (!["committee", "president"].includes(membership?.role) && actor?.platform_role !== "venue_admin") {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }
    if (event.status === "cancelled") {
      await connection.commit();
      return { ok: true, event_title: event.title, already_cancelled: true };
    }
    if (event.version !== expected_version) {
      await connection.rollback();
      return { ok: false, reason: "stale" };
    }
    if (event.started) {
      await connection.rollback();
      return { ok: false, reason: "started" };
    }

    const [recipients] = await connection.query(
      "SELECT user_id FROM participations WHERE event_id = ? AND status IN ('joined','waitlisted') FOR UPDATE", [event_id]);
    await enqueueEventJob(connection, { type: "event_cancelled", eventId: event_id, bookingId: event.booking_id,
      recipients: recipients.map(row => row.user_id), title: event.title });
    await connection.query("UPDATE event_join_requests SET status='cancelled' WHERE event_id=? AND status='pending'",[event_id]);
    await recordCancellation(connection, event_id, user_id);
    await connection.query(
      "UPDATE events SET status = 'cancelled', version=version+1 WHERE id = ?",
      [event_id],
    );
    await connection.query(
      "UPDATE bookings SET status = 'cancelled',version=version+1 WHERE id = ? AND status IN ('pending','confirmed')",
      [event.booking_id],
    );
    await connection.query(
      `UPDATE participations SET status = 'cancelled', left_at = CURRENT_TIMESTAMP(6)
       WHERE event_id = ? AND status IN ('joined', 'waitlisted')`,
      [event_id],
    );
    await audit(connection, user_id, "event", event_id, "event.cancelled", { reason });

    await connection.commit();
    return { ok: true, event_title: event.title };
  } catch (error) {
    if (connection) await connection.rollback();
    return { ok: false, reason: "database", error };
  } finally {
    if (connection) connection.release();
  }
}

async function edit_event(
  event_id,
  { title, description, bounds, expected_version, capacity, visibility, registration_closes_at },
  user_id,
) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();

    const [[locator]] = await connection.query("SELECT club_id FROM events WHERE id=?", [event_id]);
    if (!locator) { await connection.rollback(); return { ok: false, reason: "not_found" }; }
    await connection.query("SELECT id FROM clubs WHERE id=? FOR UPDATE", [locator.club_id]);
    const [[event]] = await connection.query(
      `SELECT e.id, e.booking_id, e.club_id, e.status, e.version, e.capacity, e.visibility,
         e.registration_closes_at, e.start_time, b.status AS booking_status, v.capacity AS venue_capacity
       FROM events e JOIN bookings b ON b.id=e.booking_id JOIN venues v ON v.id=b.venue_id
       WHERE e.id = ? FOR UPDATE`,
      [event_id],
    );
    if (!event) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }

    const [[membership]] = await connection.query(
      `SELECT role FROM memberships
       WHERE user_id = ? AND club_id = ? FOR UPDATE`,
      [user_id, event.club_id],
    );
    if (!["committee", "president"].includes(membership?.role)) {
      await connection.rollback();
      return { ok: false, reason: "forbidden" };
    }
    if (event.version !== expected_version) {
      await connection.rollback();
      return { ok: false, reason: "stale" };
    }
    if (!["draft", "published"].includes(event.status) || !["pending", "confirmed"].includes(event.booking_status)) {
      await connection.rollback();
      return { ok: false, reason: "unavailable" };
    }

    if (bounds || (event.status === "published" && (capacity !== undefined || visibility !== undefined || registration_closes_at !== undefined))) {
      await connection.rollback();
      return { ok: false, reason: "frozen" };
    }
    const nextCapacity = capacity ?? event.capacity;
    const nextVisibility = visibility === undefined ? event.visibility : database_visibility(visibility);
    const deadline = registration_closes_at ?? event.registration_closes_at ?? event.start_time;
    const [[valid]] = await connection.query(`SELECT ? > DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AND ? <= ? AS valid`, [deadline, deadline, event.start_time]);
    if (event.status === "draft" && (!Number.isSafeInteger(nextCapacity) || nextCapacity < 1 || nextCapacity > Math.min(event.venue_capacity, 500) || !valid.valid)) {
      await connection.rollback(); return { ok: false, reason: "invalid_details" };
    }
    await connection.query(`UPDATE events SET title=?,description=?,capacity=?,visibility=?,registration_closes_at=?,version=version+1 WHERE id=?`,
      [title.trim(), description.trim(), nextCapacity, nextVisibility, deadline, event_id]);
    const [recipients] = await connection.query(
      "SELECT user_id FROM participations WHERE event_id = ? AND status IN ('joined','waitlisted') FOR UPDATE", [event_id]);
    if (event.status === "published") await enqueueEventJob(connection, { type: "event_changed", eventId: event_id, bookingId: event.booking_id,
      recipients: recipients.map(row => row.user_id), title: title.trim() });
    await audit(connection, user_id, "event", event_id, "event.updated", {});

    await connection.commit();
    return { ok: true };
  } catch (error) {
    if (connection) await connection.rollback();
    return { ok: false, reason: "database", error };
  } finally {
    if (connection) connection.release();
  }
}

async function list_notifications(user_id) {
  const [rows] = await pool.query(
    `SELECT id, event_id, event_title, message, created_at, read_at,
       UNIX_TIMESTAMP(created_at) AS created_epoch
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    [user_id],
  );
  return rows;
}

async function mark_notification_read(notification_id, user_id) {
  const [result] = await pool.query(
    `UPDATE notifications
     SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE id = ? AND user_id = ?`,
    [notification_id, user_id],
  );
  if (result.affectedRows > 0) return true;

  const [[notification]] = await pool.query(
    "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
    [notification_id, user_id],
  );
  return Boolean(notification);
}

// Book the venue and create the event in one transaction. Returns
// { ok: true, event },
// { ok: false, reason: "unknown_club" | "unknown_venue" | "conflict", message }, or
// { ok: false, reason: "database", error }.
// If the rollback itself fails, that error propagates to the caller (as before).
async function create_event({
  club,
  title,
  description,
  date,
  venue,
  timeslot,
  visibility,
  bounds,
  capacity,
  registration_closes_at,
  user_id,
}) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();

    const [[venue_row]] = await connection.query(
      "SELECT id, capacity FROM venues WHERE name = ? FOR UPDATE", [venue]);
    if (!venue_row) {
      await connection.rollback();
      return { ok: false, reason: "unknown_venue", message: "Unknown venue" };
    }

    const [[time_check]] = await connection.query(
      "SELECT ? > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR) AS future", [bounds.start]);
    if (!time_check.future) {
      await connection.rollback();
      return { ok: false, reason: "invalid_time", message: "The selected slot has already started." };
    }
    const eventCapacity = capacity ?? Math.min(venue_row.capacity, 500);
    const deadline = registration_closes_at ?? bounds.start;
    const [[validDetails]] = await connection.query("SELECT ? > DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AND ? <= ? AS valid", [deadline, deadline, bounds.start]);
    if (!Number.isSafeInteger(eventCapacity) || eventCapacity < 1 || eventCapacity > Math.min(venue_row.capacity, 500) || !validDetails.valid) {
      await connection.rollback();
      return { ok: false, reason: "invalid_details", message: "Capacity or registration deadline is invalid." };
    }

    const [[club_row]] = await connection.query(
      "SELECT id FROM clubs WHERE name = ? FOR UPDATE",
      [club],
    );
    if (!club_row) {
      await connection.rollback();
      return { ok: false, reason: "unknown_club", message: "Unknown club" };
    }

    const [[membership]] = await connection.query(
      "SELECT role FROM memberships WHERE user_id = ? AND club_id = ? FOR UPDATE",
      [user_id, club_row.id],
    );
    if (!["committee", "president"].includes(membership?.role)) {
      await connection.rollback();
      return {
        ok: false,
        reason: "forbidden",
        message:
          "Only committee members or the president can book a venue for this club.",
      };
    }

    // The overlap check rejects every booking that intersects this time range.
    const [conflicts] = await connection.query(
      `SELECT id FROM bookings
       WHERE venue_id = ? AND status = 'confirmed'
         AND start_time < ? AND end_time > ?
       FOR UPDATE`,
      [venue_row.id, bounds.end, bounds.start],
    );
    if (conflicts.length > 0) {
      await connection.rollback();
      return {
        ok: false,
        reason: "conflict",
        message: `${venue} is already booked on ${date}, ${timeslot}`,
      };
    }

    const [booking_result] = await connection.query(
      `INSERT INTO bookings (venue_id, club_id, start_time, end_time, requested_by)
       VALUES (?, ?, ?, ?, ?)`,
      [venue_row.id, club_row.id, bounds.start, bounds.end, user_id],
    );
    const [event_result] = await connection.query(
      `INSERT INTO events
        (booking_id, club_id, title, description, start_time, end_time, visibility, capacity, registration_closes_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        booking_result.insertId,
        club_row.id,
        title.trim(),
        description.trim(),
        bounds.start,
        bounds.end,
        database_visibility(visibility),
        eventCapacity,
        deadline,
      ],
    );

    const [admins] = await connection.query(`SELECT u.id FROM users u WHERE u.platform_role='venue_admin'
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.club_id=? AND m.role IN ('committee','president'))`, [club_row.id]);
    await audit(connection, user_id, "booking", booking_result.insertId, "booking.requested", { event_id: event_result.insertId });
    await enqueueEventJob(connection, { type: "booking_requested", eventId: event_result.insertId,
      bookingId: booking_result.insertId, recipients: admins.map(row => row.id), title: title.trim() });

    await connection.commit();
    return {
      ok: true,
      event: {
        id: event_result.insertId,
        title: title.trim(),
        club,
        date,
        timeslot,
        venue,
        description: description.trim(),
        visibility,
        joined_count: 0,
        event_status: "draft",
        booking_status: "pending",
        status: "Upcoming",
      },
    };
  } catch (error) {
    if (connection) await connection.rollback();
    return { ok: false, reason: "database", error };
  } finally {
    if (connection) connection.release();
  }
}

export {
  join_event,
  reject_event_request,
  leave_event,
  list_events,
  list_my_participations,
  list_event_participants,
  create_event,
  edit_event,
  cancel_event,
  list_notifications,
  mark_notification_read,
};
