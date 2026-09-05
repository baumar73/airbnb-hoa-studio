import {applicationFeeState,isValidISODate,validatePaperwork} from './workflow.js';

const DAY=86400000;
const done=(c,id)=>(c.steps||[]).some(s=>s.id===id && s.done);

// Pure decision model. Guest reports are not independent payment/HOA evidence.
export function planGuestJourney(c,now=new Date(),{feeRequestAuthorized=true}={}) {
  const plan={state:'waiting_for_guest',guestTasks:[],waitingForEvidence:[],nextReminderAt:null,exception:null};
  if (c.status==='canceled') return {...plan,state:'canceled'};
  if (!isValidISODate(c.checkIn)||!isValidISODate(c.checkOut)) return {...plan,state:'exception',exception:'invalid_stay_dates'};
  if (new Date(c.checkOut+'T23:59:59Z')<now) return {...plan,state:'closed'};
  if (c.submissionError?.phase==='delivery_uncertain' || c.automation?.reminderClaim?.state==='uncertain') return {...plan,state:'exception',exception:'delivery_reconciliation'};
  if (done(c,'board_approved')) return {...plan,state:'approved'};
  if (c.submission||done(c,'submitted_hoa')) return {...plan,state:'waiting_for_hoa'};
  if (c.reviewLockedAt) return {...plan,state:'delivery_in_progress'};

  if (c.pathType==='full' && (!c.screeningRoute || c.screeningRoute==='undecided')) {
    plan.guestTasks.push({id:'route',text:'Choose the official application route on your paperwork page.'});
  } else if (c.pathType==='full' && c.screeningRoute==='online') {
    if (!done(c,'screening_complete')) {
      if (c.screeningReportedAt) plan.waitingForEvidence.push('external_application_completion');
      else if(!feeRequestAuthorized) plan.waitingForEvidence.push('authorized_payment_instructions');
      else plan.guestTasks.push({id:'external_application',includesPayment:true,text:'Complete the association’s online application, including its required documents and payment, then report completion on your paperwork page. Do not also send a paper application fee.'});
    } else plan.state='waiting_for_hoa';
  } else {
    const paperwork=validatePaperwork(c);
    if (!paperwork.ok) plan.guestTasks.push({id:'paperwork',text:'Complete the missing information and signatures on your paperwork page.',missing:paperwork.missing});
    if (!done(c,'ids_provided')) plan.guestTasks.push({id:'secure_ids',text:'Provide the required photo IDs through the association’s approved secure process. Do not attach IDs to an email reply.'});
    if (applicationFeeState(c)==='required' && !done(c,'fee_sent')) {
      if (c.feeMailed) plan.waitingForEvidence.push('association_payment_receipt');
      else if(!feeRequestAuthorized) plan.waitingForEvidence.push('authorized_payment_instructions');
      else plan.guestTasks.push({id:'payment',text:'Follow the association fee instructions on your paperwork page and report when you have sent the payment. Pay the association, not the property owner.'});
    }
    if (c.pathType==='full' && c.screeningRoute==='paper' && !done(c,'screening_complete')) {
      if (c.screeningReportedAt) plan.waitingForEvidence.push('official_screening_completion');
      else plan.guestTasks.push({id:'screening',text:'Complete the association’s separate official screening and report completion on your paperwork page.'});
    }
  }
  if (!plan.guestTasks.length) {
    if (plan.state==='waiting_for_guest') plan.state=plan.waitingForEvidence.length?'waiting_for_evidence':'ready_for_package_check';
    return plan;
  }
  const previous=Date.parse(c.automation?.lastGuestReminderAt||'');
  const created=Date.parse(c.createdAt||'');
  const due=Number.isFinite(previous)?previous+3*DAY:Number.isFinite(created)?created+DAY:now.getTime();
  plan.nextReminderAt=new Date(Math.max(now.getTime(),due)).toISOString();
  return plan;
}

export function guestReminderMessage(plan,origin) {
  // No bearer link, birth date, ID number, private document or booking details
  // in reminder email. Lookup uses the existing Airbnb code and surname.
  const lines=plan.guestTasks.flatMap(task=>[task.text,...(task.missing||[]).map(field=>'  - '+field)]);
  return {subject:'Your HOA paperwork — action needed',text:'Please finish the remaining items for your condominium association paperwork:\n\n'+lines.join('\n\n')+'\n\nContinue at '+origin+'/ and enter your Airbnb confirmation code and last name. Your saved progress is retained.\n\nIf you recently completed an item, update its status on your paperwork page. Payment receipt and association approval must be confirmed separately. Please do not email identity documents.'};
}
