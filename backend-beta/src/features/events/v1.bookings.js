import { Router } from "express";
import pool from "../../config/db.js";
import { decideBooking } from "./approval.service.js";

const router=Router();
const fail=(req,res,status,code,message)=>res.status(status).json({error:{code,message,fields:{},request_id:req.id}});
const id=value=>typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const sql=`SELECT b.id,b.club_id,b.venue_id,b.status,b.version,b.requested_by,b.decided_by,b.decision_reason,
  DATE_FORMAT(b.start_time,'%Y-%m-%d %H:%i:%s') AS start_local,DATE_FORMAT(b.end_time,'%Y-%m-%d %H:%i:%s') AS end_local,
  UNIX_TIMESTAMP(b.created_at) AS created_epoch,DATE_FORMAT(b.decided_at,'%Y-%m-%d %H:%i:%s.%f') AS decided_utc,
  b.start_time <= DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR) AS expired,e.id AS event_id,e.title AS event_title
  FROM bookings b JOIN events e ON e.booking_id=b.id`;
const local=value=>new Date(`${value.replace(" ","T")}+08:00`).toISOString();
const present=row=>({id:row.id,event_id:row.event_id,club_id:row.club_id,venue_id:row.venue_id,start_at:local(row.start_local),end_at:local(row.end_local),
  status:row.status,version:row.version,requested_by:row.requested_by,created_at:new Date(Number(row.created_epoch)*1000).toISOString(),
  decided_by:row.decided_by,decided_at:row.decided_utc ? new Date(`${row.decided_utc.replace(" ","T")}Z`).toISOString() : null,
  decision_reason:row.decision_reason,expired:row.status === "pending" && Boolean(row.expired),event_title:row.event_title});
async function admin(req,res) {
  if (!Number.isSafeInteger(req.session?.user_id)) { fail(req,res,401,"AUTHENTICATION_REQUIRED","Sign in to continue."); return false; }
  const [[user]]=await pool.query("SELECT platform_role FROM users WHERE id=?",[req.session.user_id]);
  if (user?.platform_role !== "venue_admin") { fail(req,res,403,"FORBIDDEN","Venue administrator access is required."); return false; }
  return true;
}

router.get("/bookings",async(req,res)=>{
  try {
    if (!await admin(req,res)) return;
    const {status,venue_id}=req.query, page=req.query.page === undefined ? 1 : id(req.query.page), size=req.query.page_size === undefined ? 20 : id(req.query.page_size);
    const venue=venue_id === undefined ? null : id(venue_id);
    if (!page || !size || size>100 || !Number.isSafeInteger((page-1)*size) ||
        Object.keys(req.query).some(key=>!["status","venue_id","page","page_size"].includes(key)) ||
        (status !== undefined && !["pending","confirmed","rejected","cancelled"].includes(status)) || (venue_id !== undefined && !venue)) {
      return fail(req,res,422,"VALIDATION_FAILED","Invalid booking filters.");
    }
    const where=[],args=[];
    if(status){where.push("b.status=?");args.push(status);} if(venue){where.push("b.venue_id=?");args.push(venue);}
    const clause=where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const [[count]]=await pool.query(`SELECT COUNT(*) AS n FROM bookings b JOIN events e ON e.booking_id=b.id${clause}`,args);
    const [rows]=await pool.query(`${sql}${clause} ORDER BY b.created_at,b.id LIMIT ? OFFSET ?`,[...args,size,(page-1)*size]);
    return res.json({data:rows.map(present),meta:{page,page_size:size,total:Number(count.n)}});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Bookings are temporarily unavailable."); }
});

router.post("/bookings/:booking_id/decision",async(req,res)=>{
  try {
    if (!await admin(req,res)) return;
    const bookingId=id(req.params.booking_id),b=req.body;
    if (!bookingId || !b || typeof b!=="object" || Array.isArray(b) || Object.keys(b).some(key=>!["expected_version","decision","reason"].includes(key)) ||
        !Number.isSafeInteger(b.expected_version) || b.expected_version<1 || !["approve","reject"].includes(b.decision) ||
        (b.reason !== undefined && (typeof b.reason!=="string" || [...b.reason.trim()].length>500)) || (b.decision==="reject" && !b.reason?.trim())) {
      return fail(req,res,422,"VALIDATION_FAILED","Provide a valid decision, version, and rejection reason.");
    }
    const result=await decideBooking(bookingId,req.session.user_id,b.expected_version,b.decision,b.reason?.trim() || "");
    if (!result.ok) {
      const errors={not_found:[404,"NOT_FOUND","Booking not found."],forbidden:[403,"FORBIDDEN","Access denied."],self_decision:[403,"SELF_DECISION_FORBIDDEN","You cannot decide your own club's request."],
        stale:[409,"STALE_VERSION","This booking changed. Refresh and try again."],conflict:[409,"VENUE_UNAVAILABLE","The venue is unavailable."],invalid_state:[409,"INVALID_STATE","This request can no longer be reviewed."]};
      const [status,code,message]=errors[result.reason] || [503,"DATABASE_UNAVAILABLE","Booking review is temporarily unavailable."];
      return fail(req,res,status,code,message);
    }
    const [[row]]=await pool.query(`${sql} WHERE b.id=?`,[bookingId]);
    return res.json({data:present(row)});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Booking review is temporarily unavailable."); }
});

router.all("/bookings",(req,res)=>{res.setHeader("Allow","GET, HEAD");return fail(req,res,405,"METHOD_NOT_ALLOWED","Method not allowed.");});
router.all("/bookings/:booking_id/decision",(req,res)=>{res.setHeader("Allow","POST");return fail(req,res,405,"METHOD_NOT_ALLOWED","Method not allowed.");});

export default router;
