import {loadKnowledgeChanges} from './storage.js';
import {applicationFeeState,isValidISODate,validatePaperwork} from './workflow.js';
import {planGuestJourney} from './journey.js';

const DAY=86400000;
const text=(v,max=200)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;
const STEPS=['route_selected','forms_sent','application','background','registration','rules_ack','lease_signed',
  'screening_complete','ids_provided','fee_sent','owner_reviewed','submitted_hoa','board_approved','checkin_released'];
const CATEGORIES=['missing_items','adverse_response','approval_candidate','payment_receipt','package_receipt','other'];
const done=(c,id)=>(c.steps||[]).some(s=>s.id===id&&s.done===true);

// Deterministic, allowlisted projection, never a wizard/email/document copy.
// No decision authority is delegated: guest claims and triage remain evidence.
export function projectKnowledgeChange(change,now=new Date()) {
  const {id,revision,value:c}=change,base={id,revision};
  if(!c)return {...base,operation:'delete',reason:'removed'};
  // A legal hold preserves originals in the portal; it is NOT permission to
  // replicate them indefinitely into a broadly searchable secondary index.
  if(c.legalHold||!isValidISODate(c.checkIn)||!isValidISODate(c.checkOut))return {...base,operation:'delete',reason:'withheld'};
  const expiresAt=new Date(Date.parse(c.checkOut+'T23:59:59Z')+90*DAY).toISOString();
  if(Date.parse(expiresAt)<=now.getTime())return {...base,operation:'delete',reason:'expired'};
  const online=c.pathType==='full'&&c.screeningRoute==='online';
  const paperwork=online?{ok:null,missing:[]}:validatePaperwork(c);
  // This describes stored workflow facts, not the passage of time. A fixed
  // clock prevents one source revision producing changing workflow summaries.
  const plan=planGuestJourney(c,new Date(0),{feeRequestAuthorized:false});
  const applicants=(c.wizard?.adults||[]).slice(0,4).map((a,i)=>({slot:i+1,
    name:[a?.firstName,a?.middleName,a?.lastName].map(v=>text(v,100)).filter(Boolean).join(' '),email:text(a?.email,254)}));
  const replies=(c.hoaMailEvents||[]).filter(e=>/^[a-f0-9]{64}$/.test(e?.id||'')).slice(-100).map(e=>({
    id:e.id,receivedAt:timestamp(e.at),categories:(e.categories||[]).filter(v=>CATEGORIES.includes(v)),
    verificationRequired:true,sourcePath:'/admin/hoa-mail/'+e.id}));
  return {...base,operation:'upsert',record:{schema:1,
    booking:{portalStatus:c.status==='canceled'?'canceled':'active',
      guestName:text(c.guestName,300),reservationCode:text(c.reservationCode,32),checkIn:c.checkIn,checkOut:c.checkOut,
      nights:integer(c.nights,3660),adults:integer(c.adults,4),createdAt:timestamp(c.createdAt)},
    applicants,workflowState:plan.state,
    application:{path:['full','guest-registration'].includes(c.pathType)?c.pathType:null,
      route:['online','paper','undecided'].includes(c.screeningRoute)?c.screeningRoute:null},
    steps:STEPS.map(id=>({id,done:done(c,id)})),
    paperwork:{saved:!!c.wizard,complete:paperwork.ok,missing:paperwork.missing,
      ownerReviewReadyAt:timestamp(c.ownerReviewReadyAt)},
    payment:{requirement:applicationFeeState(c),guestReportedAt:timestamp(c.feeMailed),receiptRecorded:done(c,'fee_sent')},
    screening:{guestReportedAt:timestamp(c.screeningReportedAt),completionRecorded:done(c,'screening_complete')},
    hoa:{status:done(c,'board_approved')?'approval_recorded':'pending',
      adverseResponseNeedsReview:replies.some(e=>e.categories.includes('adverse_response')),
      submittedAt:timestamp(c.submission?.sentAt),approvalRecorded:done(c,'board_approved'),replies,
      repliesTruncated:(c.hoaMailEvents||[]).length>replies.length},
    cancellation:{recorded:c.status==='canceled',source:c.cancellation?.source==='airbnb-email'?'airbnb-email':null,
      detectedAt:timestamp(c.cancellation?.detectedAt)},
    automation:{lastGuestReminderAt:timestamp(c.automation?.lastGuestReminderAt),
      deliveryUncertain:c.submissionError?.phase==='delivery_uncertain'||c.automation?.reminderClaim?.state==='uncertain'},
    retention:{expiresAt},
    provenance:{system:'hoa-portal',contentTrust:'untrusted_data',sourcePath:'/admin/cases',
      authoritative:false,limitations:['replica_not_live_state','email_triage_not_approval','guest_report_not_payment_receipt']},
  }};
}

async function digest(s) {return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));}
async function authorized(request,env) {
  const expected=String(env.GBRAIN_EXPORT_TOKEN||'');
  if(expected.length<32)return false;
  const [a,b]=await Promise.all([digest(request.headers.get('Authorization')||''),digest('Bearer '+expected)]);
  let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];return different===0;
}
export async function knowledgeExportResponse(request,env,securityHeaders={}) {
  const json=(data,status=200)=>Response.json(data,{status,headers:{...securityHeaders,
    'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex','Allow':'GET'}});
  if(env.GBRAIN_EXPORT_ENABLED!=='yes')return json({error:'not found'},404);
  if(request.method!=='GET')return json({error:'read-only'},405);
  if(!await authorized(request,env))return json({error:'unauthorized'},401);
  const url=new URL(request.url);
  if(url.pathname!=='/api/knowledge/changes')return json({error:'not found'},404);
  try {
    const page=await loadKnowledgeChanges(env,{cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit')});
    const now=new Date();
    return json({...page,generatedAt:now.toISOString(),changes:page.changes.map(c=>projectKnowledgeChange(c,now))});
  } catch(error) {
    if(error.code==='CASE_EXPORT_INPUT')return json({error:'invalid cursor or limit'},400);
    if(error.code==='CASE_EXPORT_RESET')return json({error:'checkpoint requires reconciliation'},409);
    // Fail the whole page. Never advance a cursor past a record we could not read.
    return json({error:'knowledge export unavailable'},503);
  }
}
