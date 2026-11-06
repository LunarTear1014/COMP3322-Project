import { Router } from "express";
import pool from "../../config/db.js";
import { timeslot_bounds, utc_to_campus_datetime } from "../../shared/timeslots.js";
import { create_event, edit_event, cancel_event, join_event, leave_event, reject_event_request } from "./events.service.js";
import { publishEvent } from "./approval.service.js";
import { getEvent, queryEvents, queryMyRegistrations, queryParticipants } from "./v1.repository.js";

const router = Router();
const slots = { morning: "10:00 - 12:00", afternoon: "13:00 - 15:00", evening: "16:00 - 18:00" };
const fail = (req, res, status, code, message, fields = {}) => res.status(status).json({ error: { code, message, fields, request_id: req.id } });
const positive = n => Number.isSafeInteger(n) && n > 0;
const id = value => typeof value === "string" && /^[1-9]\d*$/.test(value) && positive(Number(value)) ? Number(value) : null;
const hasOnly = (body, keys) => body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every(key => keys.includes(key));
const signed = (req, res) => Number.isSafeInteger(req.session?.user_id) || (fail(req, res, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue."), false);
const bad = (req, res, field, message = "Invalid input.") => fail(req, res, 422, "VALIDATION_FAILED", message, field ? { [field]: message } : {});
const translate = (req, res, result) => {
  const reasons = { not_found: [404,"NOT_FOUND","Event not found."], forbidden: [403,"FORBIDDEN","You cannot manage this event."],
    stale: [409,"STALE_VERSION","This event changed. Refresh and try again."], request_not_found: [404,"NOT_FOUND","Request is no longer pending."], conflict: [409,"VENUE_UNAVAILABLE","The venue is unavailable."],
    frozen: [409,"PUBLISHED_FIELDS_FROZEN","Published event fields are frozen."], started: [409,"EVENT_STARTED","The event has started."],
    unavailable: [409,"INVALID_STATE","This action is no longer available."], invalid_state: [409,"INVALID_STATE","This action is no longer available."],
    membership_required: [409,"MEMBERSHIP_REQUIRED","Join the organizing club first."], full: [409,"EVENT_FULL","The event is full."],
    waitlist_full: [409,"WAITLIST_FULL","The waitlist is full."], invalid_details: [422,"VALIDATION_FAILED","Invalid capacity or deadline."],
    invalid_time: [422,"VALIDATION_FAILED","The selected time has passed."], database: [503,"DATABASE_UNAVAILABLE","The service is temporarily unavailable."] };
  const [status, code, message] = reasons[result.reason] || [422,"VALIDATION_FAILED","Invalid event details."];
  return fail(req, res, status, code, message);
};
const paging = query => {
  const page = query.page === undefined ? 1 : id(query.page);
  const pageSize = query.page_size === undefined ? 20 : id(query.page_size);
  return page && pageSize && pageSize <= 100 && Number.isSafeInteger((page-1)*pageSize) ? { page, pageSize } : null;
};
const textOk = (value, max) => typeof value === "string" && value.trim().length > 0 && [...value.trim()].length <= max;
const asSqlUtc = instant => new Date(instant).toISOString().replace("T", " ").replace("Z", "");

async function list(req, res, managed) {
  if (!signed(req, res)) return;
  const allowed = managed ? ["club_id","state","page","page_size"] : ["q","club_id","venue_id","visibility","phase","from","to","page","page_size"];
  const p = paging(req.query);
  const clubId = req.query.club_id === undefined ? null : id(req.query.club_id);
  const venueId = req.query.venue_id === undefined ? null : id(req.query.venue_id);
  const { q, visibility, state, from, to } = req.query;
  const phase = managed ? null : (req.query.phase || "upcoming");
  const fromLocal = from === undefined ? null : utc_to_campus_datetime(from);
  const toLocal = to === undefined ? null : utc_to_campus_datetime(to);
  if (!p || Object.keys(req.query).some(key => !allowed.includes(key)) || (req.query.club_id !== undefined && !clubId) ||
      (req.query.venue_id !== undefined && !venueId) || (q !== undefined && (typeof q !== "string" || q.trim().length > 100)) ||
      (visibility !== undefined && !["public","members_only"].includes(visibility)) ||
      (state !== undefined && !["draft","published","cancelled"].includes(state)) ||
      (phase !== null && !["upcoming","past"].includes(phase)) || ((from === undefined) !== (to === undefined)) ||
      (from !== undefined && (!fromLocal || !toLocal || Date.parse(to) <= Date.parse(from) || Date.parse(to)-Date.parse(from) > 93*86400000))) return bad(req, res, "query", "Invalid event filters.");
  try {
    const result = await queryEvents(req.session.user_id, { managed, ...p, clubId, venueId, visibility, phase, state,
      from: from ? asSqlUtc(from) : null, to: to ? asSqlUtc(to) : null, search: q?.trim() });
    return result.forbidden ? fail(req,res,403,"FORBIDDEN","You cannot manage this club.") : res.json(result);
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Events are temporarily unavailable."); }
}

router.get("/events", (req,res) => list(req,res,false));
router.get("/me/events", (req,res) => list(req,res,true));

router.get("/me/registrations", async (req,res) => {
  if (!signed(req,res)) return;
  const p=paging(req.query), {status}=req.query;
  if (!p || Object.keys(req.query).some(key=>!["status","page","page_size"].includes(key)) ||
      (status !== undefined && !["pending","joined","waitlisted","left","cancelled"].includes(status))) return bad(req,res,"query","Invalid registration filters.");
  try { return res.json(await queryMyRegistrations(req.session.user_id,{...p,status})); }
  catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Registrations are temporarily unavailable."); }
});

router.get("/events/:event_id/participants", async(req,res)=>{
  if (!signed(req,res)) return;
  const eventId=id(req.params.event_id),p=paging(req.query),status=req.query.status ?? "joined";
  if (!eventId || !p || Object.keys(req.query).some(key=>!["status","page","page_size"].includes(key)) ||
      !["joined","waitlisted","left","cancelled"].includes(status)) return bad(req,res,"query","Invalid participant filters.");
  try {
    const event=await getEvent(req.session.user_id,eventId);
    if (!event) return fail(req,res,404,"NOT_FOUND","Event not found.");
    if (!event.can_manage) return fail(req,res,403,"FORBIDDEN","Only the club committee can view participants.");
    return res.json(await queryParticipants(eventId,{...p,status}));
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Participants are temporarily unavailable."); }
});

router.get('/events/:event_id/join-requests',async(req,res)=>{
  if(!signed(req,res)) return;
  const eventId=id(req.params.event_id),p=paging(req.query);
  if(!eventId || !p || Object.keys(req.query).some(key=>!['page','page_size'].includes(key))) return bad(req,res,'query');
  try {
    const event=await getEvent(req.session.user_id,eventId);
    if(!event) return fail(req,res,404,'NOT_FOUND','Event not found.');
    if(!event.can_manage) return fail(req,res,403,'FORBIDDEN','Only the organizing committee can review requests.');
    const [[count]]=await pool.query("SELECT COUNT(*) AS n FROM event_join_requests WHERE event_id=? AND status='pending'",[eventId]);
    const [rows]=await pool.query(`SELECT r.user_id,u.name,u.email,r.allow_waitlist FROM event_join_requests r JOIN users u ON u.id=r.user_id
      WHERE r.event_id=? AND r.status='pending' ORDER BY r.requested_at,r.user_id LIMIT ? OFFSET ?`,[eventId,p.pageSize,(p.page-1)*p.pageSize]);
    return res.json({data:rows.map(row=>({...row,allow_waitlist:Boolean(row.allow_waitlist)})),meta:{page:p.page,page_size:p.pageSize,total:Number(count.n)}});
  } catch {return fail(req,res,503,'DATABASE_UNAVAILABLE','Requests are temporarily unavailable.');}
});

router.post('/events/:event_id/join-requests/:user_id/decision',async(req,res)=>{
  if(!signed(req,res)) return;
  const eventId=id(req.params.event_id),userId=id(req.params.user_id),body=req.body;
  if(!eventId || !userId || !hasOnly(body,['decision']) || !['accept','reject'].includes(body.decision)) return bad(req,res,'body','Provide accept or reject.');
  try {
    const result=body.decision==='accept' ? await join_event(eventId,userId,true,req.session.user_id) : await reject_event_request(eventId,userId,req.session.user_id);
    if(!result.ok) return translate(req,res,result);
    return res.json({data:{event_id:eventId,user_id:userId,status:result.status}});
  } catch {return fail(req,res,503,'DATABASE_UNAVAILABLE','Request review is temporarily unavailable.');}
});

router.get("/events/:event_id", async (req,res) => {
  if (!signed(req,res)) return;
  const eventId = id(req.params.event_id); if (!eventId) return bad(req,res,"event_id");
  try { const event = await getEvent(req.session.user_id,eventId); return event ? res.json({data:event}) : fail(req,res,404,"NOT_FOUND","Event not found."); }
  catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Event is temporarily unavailable."); }
});

router.post("/events", async (req,res) => {
  if (!signed(req,res)) return;
  const b=req.body;
  if (!hasOnly(b,["club_id","venue_id","title","description","date","slot_id","visibility","capacity","registration_closes_at"]) ||
      !positive(b.club_id) || !positive(b.venue_id) || !textOk(b.title,255) || !textOk(b.description,10000) ||
      !Object.hasOwn(slots,b.slot_id) || !timeslot_bounds(b.date,slots[b.slot_id]) || !["public","members_only"].includes(b.visibility) ||
      !positive(b.capacity) || b.capacity>500 || (b.registration_closes_at !== undefined && !utc_to_campus_datetime(b.registration_closes_at))) return bad(req,res,"body","Invalid event details.");
  try {
    const [[club]] = await pool.query("SELECT name FROM clubs WHERE id=?",[b.club_id]);
    const [[venue]] = await pool.query("SELECT name FROM venues WHERE id=?",[b.venue_id]);
    if (!club || !venue) return bad(req,res,"body","Unknown club or venue.");
    const result = await create_event({ club:club.name,venue:venue.name,title:b.title,description:b.description,date:b.date,
      timeslot:slots[b.slot_id],visibility:b.visibility === "public" ? "Public" : "Members only",capacity:b.capacity,
      registration_closes_at:b.registration_closes_at ? utc_to_campus_datetime(b.registration_closes_at) : undefined,
      bounds:timeslot_bounds(b.date,slots[b.slot_id]),user_id:req.session.user_id });
    if (!result.ok) return translate(req,res,result);
    return res.status(201).json({ data:await getEvent(req.session.user_id,result.event.id) });
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Event creation is temporarily unavailable."); }
});

router.patch("/events/:event_id", async (req,res) => {
  if (!signed(req,res)) return;
  const eventId=id(req.params.event_id), b=req.body;
  const keys=["expected_version","title","description","capacity","visibility","registration_closes_at"];
  if (!eventId || !hasOnly(b,keys) || !positive(b.expected_version) || Object.keys(b).length < 2 ||
      (b.title !== undefined && !textOk(b.title,255)) || (b.description !== undefined && !textOk(b.description,10000)) ||
      (b.capacity !== undefined && (!positive(b.capacity) || b.capacity>500)) ||
      (b.visibility !== undefined && !["public","members_only"].includes(b.visibility)) ||
      (b.registration_closes_at !== undefined && !utc_to_campus_datetime(b.registration_closes_at))) return bad(req,res,"body","Invalid event details.");
  try {
    const event = await getEvent(req.session.user_id,eventId);
    if (!event) return fail(req,res,404,"NOT_FOUND","Event not found.");
    if (!event.can_manage) return fail(req,res,403,"FORBIDDEN","You cannot manage this event.");
    const result=await edit_event(eventId,{ title:b.title ?? event.title, description:b.description ?? event.description,
      expected_version:b.expected_version,capacity:b.capacity,visibility:b.visibility === undefined ? undefined : b.visibility === "public" ? "Public" : "Members only",
      registration_closes_at:b.registration_closes_at === undefined ? undefined : utc_to_campus_datetime(b.registration_closes_at) },req.session.user_id);
    if (!result.ok) return translate(req,res,result);
    return res.json({data:await getEvent(req.session.user_id,eventId)});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Event update is temporarily unavailable."); }
});

router.post(["/events/:event_id/publish", "/events/:event_id/cancel"], async (req,res) => {
  if (!signed(req,res)) return;
  const eventId=id(req.params.event_id), b=req.body, cancelling=req.path.endsWith("/cancel");
  if (!eventId || !hasOnly(b,cancelling ? ["expected_version","reason"] : ["expected_version"]) || !positive(b.expected_version) ||
      (cancelling && !textOk(b.reason,500))) return bad(req,res,"body","Provide the current version and a valid reason where required.");
  try {
    const event=await getEvent(req.session.user_id,eventId);
    if (!event) return fail(req,res,404,"NOT_FOUND","Event not found.");
    const result=cancelling ? await cancel_event(eventId,req.session.user_id,b.expected_version,b.reason.trim()) : await publishEvent(eventId,req.session.user_id,b.expected_version);
    if (!result.ok) return translate(req,res,result);
    return res.json({data:await getEvent(req.session.user_id,eventId)});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Event action is temporarily unavailable."); }
});

router.post("/events/:event_id/registration", async (req,res) => {
  if (!signed(req,res)) return;
  const eventId=id(req.params.event_id), b=req.body;
  if (!eventId || !hasOnly(b,["allow_waitlist"]) || typeof b.allow_waitlist !== "boolean") return bad(req,res,"body","Specify whether to join the waitlist.");
  try {
    if (!(await getEvent(req.session.user_id,eventId))) return fail(req,res,404,"NOT_FOUND","Event not found.");
    const result=await join_event(eventId,req.session.user_id,b.allow_waitlist); if (!result.ok) return translate(req,res,result);
    const event=await getEvent(req.session.user_id,eventId);
    return res.status(result.unchanged ? 200 : 201).json({data:{event_id:eventId,status:event.my_registration.status,
      queue_position:event.my_registration.queue_position,joined_count:event.joined_count,waitlisted_count:event.waitlisted_count}});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Registration is temporarily unavailable."); }
});

router.delete("/events/:event_id/registration", async (req,res) => {
  if (!signed(req,res)) return;
  const eventId=id(req.params.event_id);
  if (!eventId || !hasOnly(req.body,[]) || Object.keys(req.body).length) return bad(req,res,"body","Provide an empty object.");
  try {
    if (!(await getEvent(req.session.user_id,eventId))) return fail(req,res,404,"NOT_FOUND","Event not found.");
    const result=await leave_event(eventId,req.session.user_id); if (!result.ok) return translate(req,res,result);
    const event=await getEvent(req.session.user_id,eventId);
    return res.json({data:{event_id:eventId,status:event.my_registration.status === "none" ? "left" : event.my_registration.status,
      queue_position:event.my_registration.queue_position,joined_count:event.joined_count,waitlisted_count:event.waitlisted_count}});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Withdrawal is temporarily unavailable."); }
});

for (const [path, allow] of [
  ["/events", "GET, HEAD, POST"], ["/me/events", "GET, HEAD"], ["/me/registrations", "GET, HEAD"],
  ["/events/:event_id/participants", "GET, HEAD"],
  ['/events/:event_id/join-requests', 'GET, HEAD'], ['/events/:event_id/join-requests/:user_id/decision', 'POST'],
  ["/events/:event_id", "GET, HEAD, PATCH"], ["/events/:event_id/publish", "POST"],
  ["/events/:event_id/cancel", "POST"], ["/events/:event_id/registration", "POST, DELETE"],
]) router.all(path,(req,res)=>{res.setHeader("Allow",allow); return fail(req,res,405,"METHOD_NOT_ALLOWED","Method not allowed.");});

export default router;
