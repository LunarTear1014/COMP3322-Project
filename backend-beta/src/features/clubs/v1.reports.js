import { Router } from "express";
import { clubReport, parseReportRange } from "./reports.service.js";

const router=Router();
const fail=(req,res,status,code,message)=>res.status(status).json({error:{code,message,fields:{},request_id:req.id}});
router.get("/clubs/:club_id/reports",async(req,res)=>{
  if(!Number.isSafeInteger(req.session?.user_id)) return fail(req,res,401,"AUTHENTICATION_REQUIRED","Sign in to view reports.");
  const text=req.params.club_id, clubId=/^[1-9]\d*$/.test(text) ? Number(text) : null;
  const range=parseReportRange(req.query.from,req.query.to);
  if(!Number.isSafeInteger(clubId) || !clubId || !range || Object.keys(req.query).some(key=>!["from","to"].includes(key))) {
    return fail(req,res,422,"VALIDATION_FAILED","Provide a valid club and UTC range of at most 93 days.");
  }
  try {
    const result=await clubReport(clubId,req.session.user_id,range);
    if(result.reason === "not_found") return fail(req,res,404,"NOT_FOUND","Club not found.");
    if(result.reason === "forbidden") return fail(req,res,403,"FORBIDDEN","Only this club's committee can view reports.");
    return res.json(result);
  } catch { return fail(req,res,503,"DATABASE_UNAVAILABLE","Reports are temporarily unavailable."); }
});
router.all("/clubs/:club_id/reports",(req,res)=>{res.setHeader("Allow","GET, HEAD");return fail(req,res,405,"METHOD_NOT_ALLOWED","Method not allowed.");});
export default router;
