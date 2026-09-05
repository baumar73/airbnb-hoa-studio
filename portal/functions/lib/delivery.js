import {CaseStoreError,loadStoredCases,saveStoredCases} from './storage.js';

function applyOutcome(c, outcome) {
  for (const key of ['submission','testSubmission','submissionError','testSubmissionError']) {
    if (!Object.hasOwn(outcome,key)) continue;
    if (outcome[key]===null) delete c[key]; else c[key]=outcome[key];
  }
  if (outcome.submission) {
    for (const step of c.steps||[]) {
      if (['application','background','rules_ack','lease_signed','registration','owner_reviewed','submitted_hoa'].includes(step.id) && !step.done) {
        step.done=true;step.date=outcome.submission.sentAt;
      }
    }
  }
}

// Retry only receipt persistence, NEVER the external delivery. A fresh record
// preserves concurrent status/notes changes. A deleted case is not resurrected.
export async function persistDeliveryOutcome(env, originalCases, claimed, outcome) {
  for (let attempt=0;attempt<4;attempt++) {
    const cases=env.CASE_STORE ? await loadStoredCases(env) : originalCases;
    const current=cases.find(c=>c.id===claimed.id);
    if (!current || current.reviewLockedAt!==claimed.reviewLockedAt || current.reviewHash!==claimed.reviewHash ||
      (claimed.preparedPackage && (current.preparedPackage?.id!==claimed.preparedPackage.id || current.preparedPackage?.packageHash!==claimed.preparedPackage.packageHash))) {
      throw new CaseStoreError('CASE_DELIVERY_CHANGED','Delivery claim or package context changed; reconcile the sent-mail record manually');
    }
    applyOutcome(current,outcome);
    try {
      await saveStoredCases(env,cases);
      applyOutcome(claimed,outcome);
      return;
    } catch(error) {
      if (error.code!=='CASE_CONFLICT' || attempt===3) throw error;
    }
  }
}
