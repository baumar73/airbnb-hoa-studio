// Only explicit owner verification may create these records. Mail classification
// never calls this reducer. No source prose or arbitrary links enter guest tasks.
export const HOA_ITEMS=Object.freeze({
  application_details:'Application details',documents:'Required documents',signatures:'Missing signatures',
  identity_documents:'Secure identity-document handoff',payment:'Payment status clarification',
  supplementary_form:'Supplementary form requested by the association',
});
export const HOA_CONFIRMATIONS=Object.freeze({
  application_received:'Application received (not complete or approved)',
  payment_received:'Required payment received',documents_complete:'Required documents confirmed complete',
  application_complete:'Official application/screening confirmed complete',hoa_approved:'HOA approval explicitly verified for this stay',
});
const stepFor={payment_received:'fee_sent',application_complete:'screening_complete',hoa_approved:'board_approved'};
const fail=(error,status=409)=>({ok:false,error,status});
const activeTask=t=>['open','reported'].includes(t.status);
export function hoaCaseContext(c) {
  return JSON.stringify([c.reservationCode||'',c.guestName||'',c.checkIn,c.checkOut,c.adults,c.expectedMinors||0,c.screeningRoute||'',c.pathType]);
}
export function hoaEvidenceState(c) {
  const context=hoaCaseContext(c),tasks=c.hoaTasks||[],evidence=Object.values(c.hoaEvidence||{});
  const stale=tasks.some(t=>activeTask(t)&&t.context!==context)||evidence.some(e=>!e.supersededAt&&e.context!==context);
  const pending=(c.hoaMailEvents||[]).some(e=>!e.review&&e.reviewRequired&&(e.categories||[]).some(k=>['missing_items','adverse_response','other'].includes(k)));
  return {tasks:tasks.filter(activeTask),exception:stale?'hoa_evidence_stale':c.hoaReviewHold?.reason||(pending?'hoa_source_review':null)};
}
export function hoaTaskText(c,code) {
  const online=c.screeningRoute==='online';
  const where=online?'in your existing Tenant Evaluation application':'through the association’s approved process';
  const text={
    application_details:`Correct the application details requested by the association ${where}.`,
    documents:`Provide the outstanding documents requested by the association ${where}. Do not start a second application.`,
    signatures:`Complete the missing signatures requested by the association ${where}.`,
    identity_documents:`Provide the outstanding identity documents ${where}, using its secure identity-document process. Do not email IDs or upload them to this portal.`,
    payment:`Clarify the outstanding fee/payment status ${where}. Check the verified instructions on your paperwork page. If you already paid, ask the application service or association to trace that payment. Do not pay twice.`,
    supplementary_form:`Complete the supplementary form (for example a Tenant Check / Background Check form) ${where}. Do not email or upload identity documents to this portal; use your page for the form itself.`,
  };
  return Object.hasOwn(text,code)?text[code]:'';
}
function setStep(c,id,done,at) {
  let step=(c.steps||[]).find(s=>s.id===id);
  if(!step) {step={id,label:id};c.steps=[...(c.steps||[]),step];}
  step.done=done;step.date=done?at:null;
}
function invalidate(c,keys,at) {
  for(const key of keys) {
    if(c.hoaEvidence?.[key]) c.hoaEvidence[key]={...c.hoaEvidence[key],disputedAt:at};
    if(stepFor[key]) setStep(c,stepFor[key],false,at);
  }
  delete c.aiReview;delete c.ownerApprovedAt;delete c.ownerApprovedBy;delete c.ownerApprovedReviewHash;
}
export function reviewHoaEvidence(c,sourceId,input,now=new Date()) {
  const event=(c.hoaMailEvents||[]).find(e=>e.id===sourceId);
  if(!/^[a-f0-9]{64}$/.test(sourceId)||!event) return fail('Link this source to the reservation before reviewing it.');
  if(event.review) return fail('This source was already reviewed. Use a later source for a new decision.');
  if(c.status==='canceled'||Date.parse(c.checkOut+'T23:59:59Z')<now.getTime()) return fail('This reservation is closed.');
  if((c.reviewLockedAt&&!c.submission?.sentAt)||c.submissionError?.phase==='delivery_uncertain'||['claimed','uncertain'].includes(c.automation?.reminderClaim?.state)) return fail('Reconcile the active delivery before changing evidence.');
  if(input.attested!==true||!String(input.by||'').trim()) return fail('Verify the original source, sender, reservation and stay first.',400);
  const kind=input.kind||'confirmed',confirmed=input.confirmations||[],requested=input.requestedItems||[],resolved=input.resolvedItems||[];
  if(!['confirmed','needs_review','adverse_response','no_action'].includes(kind)||
    ![confirmed,requested,resolved].every(v=>Array.isArray(v)&&v.length<=30&&v.every(x=>typeof x==='string')&&new Set(v).size===v.length)||
    confirmed.some(k=>!Object.hasOwn(HOA_CONFIRMATIONS,k))||requested.some(k=>!Object.hasOwn(HOA_ITEMS,k))) return fail('Invalid evidence selection.',400);
  if(kind!=='confirmed'&&(confirmed.length||requested.length||resolved.length||input.clearHold||input.reconcileContext)) return fail('An unresolved source cannot also confirm facts or guest tasks.',400);
  if(kind==='confirmed'&&!confirmed.length&&!requested.length&&!resolved.length&&!input.clearHold) return fail('Select a verified fact or task.',400);
  const context=hoaCaseContext(c),tasks=c.hoaTasks||[];
  if(resolved.some(id=>!tasks.some(t=>t.id===id&&activeTask(t)&&t.context===context))) return fail('A selected task is stale or no longer open.');
  if(requested.some(code=>tasks.some(t=>t.code===code&&resolved.includes(t.id)))) return fail('Do not request and resolve the same item together.',400);
  const outstanding=[...tasks.filter(t=>activeTask(t)&&!resolved.includes(t.id)&&!(input.reconcileContext&&t.context!==context)).map(t=>t.code),...requested];
  if((confirmed.includes('payment_received')&&outstanding.includes('payment'))||
    (confirmed.includes('documents_complete')&&outstanding.some(k=>['documents','signatures','identity_documents'].includes(k)))||
    (confirmed.some(k=>['application_complete','hoa_approved'].includes(k))&&outstanding.length)) return fail('Resolve conflicting outstanding items before confirming completion.',400);
  if(hoaEvidenceState(c).exception==='hoa_evidence_stale'&&!input.reconcileContext) return fail('Reservation details changed. Reconcile the earlier evidence and tasks before recording new confirmations.');
  if(c.hoaReviewHold&&!input.clearHold&&kind==='confirmed'&&confirmed.length) return fail('Explicitly reconcile the outstanding owner-review hold first.');
  // No mutations above this line: rejected input cannot partially update a case.
  const at=now.toISOString(),by=String(input.by).slice(0,100);
  event.review={at,by,kind,context,confirmations:[...confirmed],requestedItems:[...requested],resolvedItems:[...resolved],clearHold:!!input.clearHold,reconcileContext:!!input.reconcileContext};
  event.reviewRequired=kind==='needs_review'||kind==='adverse_response';
  if(input.reconcileContext) {
    // Legacy step flags may lack a source record. They must not authorize a
    // changed stay just because a different fact was freshly re-verified.
    invalidate(c,['payment_received','documents_complete','application_complete','hoa_approved'],at);
    for(const task of tasks) if(activeTask(task)&&task.context!==context) Object.assign(task,{status:'superseded',supersededAt:at,supersededBy:sourceId});
    for(const [key,evidence] of Object.entries(c.hoaEvidence||{})) if(!evidence.supersededAt&&evidence.context!==context) {
      c.hoaEvidence[key]={...evidence,supersededAt:at};if(stepFor[key]) setStep(c,stepFor[key],false,at);
    }
    delete c.aiReview;
  }
  if(kind==='needs_review'||kind==='adverse_response') {
    c.hoaReviewHold={sourceId,at,reason:kind==='adverse_response'?'hoa_adverse_response':'hoa_source_review'};
    invalidate(c,['hoa_approved'],at);
  }
  if(input.clearHold) delete c.hoaReviewHold;
  for(const id of resolved) Object.assign(tasks.find(t=>t.id===id),{status:'resolved',resolvedAt:at,resolvedBy:by,resolutionSourceId:sourceId});
  for(const code of requested) {
    let task=tasks.find(t=>t.code===code&&activeTask(t));
    if(!task) {task={id:sourceId+':'+code,code,version:0};tasks.push(task);}
    Object.assign(task,{status:'open',sourceId,context,openedAt:at,version:task.version+1});delete task.reportedAt;
    invalidate(c,code==='payment'?['payment_received','application_complete','hoa_approved']:['documents_complete','application_complete','hoa_approved'],at);
    if(code==='identity_documents') setStep(c,'ids_provided',false,at);
  }
  if(requested.length||resolved.length) c.hoaTasks=tasks;
  for(const key of confirmed) {
    c.hoaEvidence={...c.hoaEvidence,[key]:{sourceId,at,by,context}};
    if(stepFor[key]) setStep(c,stepFor[key],true,at);
  }
  return {ok:true};
}
export function reportHoaTask(c,id,version,now=new Date()) {
  if(c.status==='canceled'||Date.parse(c.checkOut+'T23:59:59Z')<now.getTime()) return fail('This reservation is closed.');
  if(hoaEvidenceState(c).exception) return fail('This case needs owner review first.');
  const task=(c.hoaTasks||[]).find(t=>t.id===id&&activeTask(t));
  if(!task||task.version!==version||task.context!==hoaCaseContext(c)) return fail('The task changed. Reload your paperwork page.');
  if(!task.reportedAt) {task.reportedAt=now.toISOString();task.status='reported';}
  return {ok:true};
}
