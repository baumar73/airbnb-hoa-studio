const fields=c=>({guestName:String(c.guestName||''),checkIn:String(c.checkIn||''),checkOut:String(c.checkOut||''),adults:Number(c.adults||0)});

export function reconcileBookingUpdate(c,booking,now=new Date()) {
  if(!c||!booking||c.reservationCode!==booking.code)return {changed:false};
  const before=fields(c),after={guestName:String(booking.guestName||''),checkIn:String(booking.checkIn||''),checkOut:String(booking.checkOut||''),adults:Number(booking.adults||0)};
  if(JSON.stringify(before)===JSON.stringify(after))return {changed:false};
  const supersededAt=now.toISOString();
  // A changed stay does not tell us whether an earlier SMTP attempt succeeded.
  // Retain its fence and archive reference even after the owner acknowledges
  // the new booking; acknowledgement is not reconciliation of sent mail.
  const unresolvedDelivery=!!c.reviewLockedAt&&!c.submission?.sentAt;
  if(unresolvedDelivery) {
    c.submissionError={at:c.submissionError?.at||supersededAt,phase:'delivery_uncertain',
      message:'Booking changed while prior package delivery remains unresolved. Reconcile sent mail before releasing another package.',
      packageId:c.submissionError?.packageId||c.preparedPackage?.id||null,
      packageHash:c.submissionError?.packageHash||c.preparedPackage?.packageHash||null};
  }
  if(c.submission&&!c.submission.supersededAt)c.supersededSubmission={...c.submission,supersededAt};
  delete c.submission;delete c.preparedPackage;delete c.aiReview;delete c.ownerApprovedAt;delete c.ownerApprovedBy;delete c.ownerApprovedReviewHash;
  if(!unresolvedDelivery) delete c.reviewLockedAt;
  delete c.reviewHash;delete c.reviewStartedAt;
  for(const step of c.steps||[]) if(step.done) {step.done=false;step.supersededAt=supersededAt;step.date=null;}
  c.bookingChange={source:'airbnb-email',detectedAt:supersededAt,pending:true,previous:before,current:after};
  Object.assign(c,after);
  c.nights=Math.round((new Date(`${after.checkOut}T12:00:00Z`)-new Date(`${after.checkIn}T12:00:00Z`))/86400000);
  c.workflowRevision=(Number.isSafeInteger(c.workflowRevision)?c.workflowRevision:0)+1;
  return {changed:true,previous:before,current:after};
}

export function acknowledgeBookingChange(c,now=new Date()) {
  if(!c?.bookingChange?.pending)return false;
  c.bookingChange={...c.bookingChange,pending:false,acknowledgedAt:now.toISOString()};
  return true;
}
