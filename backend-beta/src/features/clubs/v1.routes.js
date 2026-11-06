import { Router } from "express";
import pool from "../../config/db.js";
import { join_club, leave_club, list_join_requests, review_join_request } from "./clubs.service.js";

const router=Router();
const fail=(req,res,status,code,message)=>res.status(status).json({error:{code,message,fields:{},request_id:req.id}});
const positive=value=>typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const signed=(req,res)=>Number.isSafeInteger(req.session?.user_id) || (fail(req,res,401,"AUTHENTICATION_REQUIRED","Sign in to continue."),false);
const paging=query=>{
  const page=query.page === undefined ? 1 : positive(query.page),size=query.page_size === undefined ? 20 : positive(query.page_size);
  return page && size && size<=100 && Number.isSafeInteger((page-1)*size) && Object.keys(query).every(key=>["page","page_size"].includes(key)) ? {page,size} : null;
};
const role=value=>value === "president" ? "committee" : value;
const utc=value=>value == null ? null : new Date(Number(value)*1000).toISOString();

router.get("/clubs",async(req,res)=>{
  if(!signed(req,res)) return;
  const p=paging(req.query); if(!p) return fail(req,res,422,"VALIDATION_FAILED","Invalid pagination.");
  try {
    const [[count]]=await pool.query("SELECT COUNT(*) AS n FROM clubs");
    const [rows]=await pool.query(`SELECT c.id,c.name,c.description,m.role AS my_role,
      EXISTS(SELECT 1 FROM club_join_requests r WHERE r.club_id=c.id AND r.user_id=? AND r.status='pending') AS request_pending FROM clubs c
      LEFT JOIN memberships m ON m.club_id=c.id AND m.user_id=? ORDER BY c.id LIMIT ? OFFSET ?`,[req.session.user_id,req.session.user_id,p.size,(p.page-1)*p.size]);
    return res.json({data:rows.map(row=>({...row,my_role:role(row.my_role)})),meta:{page:p.page,page_size:p.size,total:Number(count.n)}});
  } catch {return fail(req,res,503,"DATABASE_UNAVAILABLE","Clubs are temporarily unavailable.");}
});

router.get("/me/memberships",async(req,res)=>{
  if(!signed(req,res)) return;
  const p=paging(req.query); if(!p) return fail(req,res,422,"VALIDATION_FAILED","Invalid pagination.");
  try {
    const [[count]]=await pool.query("SELECT COUNT(*) AS n FROM memberships WHERE user_id=?",[req.session.user_id]);
    const [rows]=await pool.query(`SELECT c.id AS club_id,c.name AS club_name,m.role,UNIX_TIMESTAMP(m.joined_at) AS joined_epoch
      FROM memberships m JOIN clubs c ON c.id=m.club_id WHERE m.user_id=? ORDER BY c.id LIMIT ? OFFSET ?`,[req.session.user_id,p.size,(p.page-1)*p.size]);
    return res.json({data:rows.map(row=>({club_id:row.club_id,club_name:row.club_name,role:role(row.role),joined_at:utc(row.joined_epoch)})),
      meta:{page:p.page,page_size:p.size,total:Number(count.n)}});
  } catch {return fail(req,res,503,"DATABASE_UNAVAILABLE","Memberships are temporarily unavailable.");}
});

router.put("/clubs/:club_id/membership",async(req,res)=>{
  if(!signed(req,res)) return;
  const clubId=positive(req.params.club_id);
  if(!clubId || !req.body || Array.isArray(req.body) || typeof req.body!=="object" || Object.keys(req.body).length) return fail(req,res,422,"VALIDATION_FAILED","Provide a valid club and an empty object.");
  try {
    const result=await join_club(clubId,req.session.user_id);
    if(result.reason==='not_found') return fail(req,res,404,'NOT_FOUND','Club not found.');
    if(result.reason==='already_member') return res.status(200).json({data:{club_id:clubId,status:'member'}});
    if(result.reason==='already_pending') return res.status(200).json({data:{club_id:clubId,status:'pending'}});
    return res.status(202).json({data:{club_id:clubId,status:'pending',request_id:result.request_id}});
  } catch {return fail(req,res,503,"DATABASE_UNAVAILABLE","Membership is temporarily unavailable.");}
});

router.get('/clubs/:club_id/join-requests',async(req,res)=>{
  if(!signed(req,res)) return;
  const clubId=positive(req.params.club_id);
  if(!clubId || Object.keys(req.query).length) return fail(req,res,422,'VALIDATION_FAILED','Invalid club.');
  try {
    const result=await list_join_requests(clubId,req.session.user_id);
    if(!result.ok) return fail(req,res,result.reason==='not_found'?404:403,result.reason==='not_found'?'NOT_FOUND':'FORBIDDEN','Unable to view club requests.');
    return res.json({data:result.requests});
  } catch {return fail(req,res,503,'DATABASE_UNAVAILABLE','Requests are temporarily unavailable.');}
});

router.post('/clubs/:club_id/join-requests/:request_id/decision',async(req,res)=>{
  if(!signed(req,res)) return;
  const clubId=positive(req.params.club_id),requestId=positive(req.params.request_id),body=req.body;
  if(!clubId || !requestId || !body || Array.isArray(body) || Object.keys(body).length!==1 || !['accept','reject'].includes(body.decision)) return fail(req,res,422,'VALIDATION_FAILED','Provide accept or reject.');
  try {
    const result=await review_join_request(clubId,requestId,req.session.user_id,body.decision);
    if(!result.ok) return fail(req,res,result.reason==='forbidden'?403:404,result.reason==='forbidden'?'FORBIDDEN':'NOT_FOUND','Request is unavailable.');
    return res.json({data:{request_id:requestId,status:body.decision==='accept'?'accepted':'rejected'}});
  } catch {return fail(req,res,503,'DATABASE_UNAVAILABLE','Request review is temporarily unavailable.');}
});

router.delete("/clubs/:club_id/membership",async(req,res)=>{
  if(!signed(req,res)) return;
  const clubId=positive(req.params.club_id);
  if(!clubId || !req.body || Array.isArray(req.body) || typeof req.body!=="object" || Object.keys(req.body).length) return fail(req,res,422,"VALIDATION_FAILED","Provide a valid club and an empty object.");
  try {
    const result=await leave_club(clubId,req.session.user_id);
    if(result.ok || result.reason === "not_a_member") return res.status(204).end();
    if(result.reason === "not_found") return fail(req,res,404,"NOT_FOUND","Club not found.");
    if(result.reason === "active_registration") return fail(req,res,409,"ACTIVE_MEMBER_REGISTRATIONS","Withdraw from future members-only events first.");
    return fail(req,res,409,"COMMITTEE_MEMBERSHIP_PROTECTED","Leave the committee before leaving the club.");
  } catch {return fail(req,res,503,"DATABASE_UNAVAILABLE","Membership is temporarily unavailable.");}
});

for (const [path, allow] of [["/clubs", "GET, HEAD"], ["/me/memberships", "GET, HEAD"], ["/clubs/:club_id/membership", "PUT, DELETE"], ['/clubs/:club_id/join-requests','GET, HEAD'], ['/clubs/:club_id/join-requests/:request_id/decision','POST']]) {
  router.all(path, (req, res) => { res.setHeader("Allow", allow); return fail(req, res, 405, "METHOD_NOT_ALLOWED", "Method not allowed."); });
}

export default router;
