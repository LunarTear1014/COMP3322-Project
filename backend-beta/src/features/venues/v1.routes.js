import { Router } from "express";
import pool from "../../config/db.js";
import { parseUtcRange } from "../../shared/utc.js";

const router=Router();
const fail=(req,res,status,code,message)=>res.status(status).json({error:{code,message,fields:{},request_id:req.id}});
const positive=value=>typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const signed=(req,res)=>Number.isSafeInteger(req.session?.user_id) || (fail(req,res,401,"AUTHENTICATION_REQUIRED","Sign in to continue."),false);

router.get("/venues",async(req,res)=>{
  if(!signed(req,res)) return;
  const page=req.query.page === undefined ? 1 : positive(req.query.page),size=req.query.page_size === undefined ? 20 : positive(req.query.page_size);
  if(!page || !size || size>100 || !Number.isSafeInteger((page-1)*size) || Object.keys(req.query).some(key=>!["page","page_size"].includes(key))) {
    return fail(req,res,422,"VALIDATION_FAILED","Invalid pagination.");
  }
  try {
    const [[count]]=await pool.query("SELECT COUNT(*) AS total FROM venues");
    const [rows]=await pool.query("SELECT id,name,location,description,capacity FROM venues ORDER BY id LIMIT ? OFFSET ?",[size,(page-1)*size]);
    return res.json({data:rows.map(row=>({...row,is_active:true})),meta:{page,page_size:size,total:Number(count.total)}});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Venues are temporarily unavailable."); }
});

router.get("/venues/:venue_id/calendar",async(req,res)=>{
  if(!signed(req,res)) return;
  const venueId=positive(req.params.venue_id),range=parseUtcRange(req.query.from,req.query.to,31);
  if(!venueId || !range || Object.keys(req.query).some(key=>!["from","to"].includes(key))) {
    return fail(req,res,422,"VALIDATION_FAILED","Provide a valid venue and UTC range of at most 31 days.");
  }
  try {
    const [[venue]]=await pool.query("SELECT id FROM venues WHERE id=?",[venueId]);
    if(!venue) return fail(req,res,404,"NOT_FOUND","Venue not found.");
    const [rows]=await pool.query(`SELECT DATE_FORMAT(DATE_SUB(b.start_time,INTERVAL 8 HOUR),'%Y-%m-%dT%H:%i:%sZ') AS start_at,
      DATE_FORMAT(DATE_SUB(b.end_time,INTERVAL 8 HOUR),'%Y-%m-%dT%H:%i:%sZ') AS end_at,
      CASE WHEN e.status='published' THEN e.id ELSE NULL END AS event_id,
      CASE WHEN e.status='published' THEN e.title ELSE NULL END AS title,
      CASE WHEN e.status='published' THEN e.club_id ELSE NULL END AS club_id
      FROM bookings b LEFT JOIN events e ON e.booking_id=b.id WHERE b.venue_id=? AND b.status='confirmed'
        AND b.start_time < DATE_ADD(?,INTERVAL 8 HOUR) AND b.end_time > DATE_ADD(?,INTERVAL 8 HOUR)
      ORDER BY b.start_time,b.id`,[venueId,range.end.sql,range.start.sql]);
    return res.json({data:{venue_id:venueId,from:range.start.iso,to:range.end.iso,campus_timezone:"Asia/Hong_Kong",bookings:rows.map(row=>({...row,busy:true}))}});
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Calendar is temporarily unavailable."); }
});
router.all("/venues",(req,res)=>{res.setHeader("Allow","GET, HEAD");return fail(req,res,405,"METHOD_NOT_ALLOWED","Method not allowed.");});
router.all("/venues/:venue_id/calendar",(req,res)=>{res.setHeader("Allow","GET, HEAD");return fail(req,res,405,"METHOD_NOT_ALLOWED","Method not allowed.");});
export default router;
