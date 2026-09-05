import {validateEmailAddress} from './workflow.js';
import {usableAirbnbRelay} from './airbnb-relay.js';

// An explicit guest choice takes precedence over an older paper-form address.
// This is a guest-requested channel, not proof of mailbox ownership.
export function guestReminderEmail(c) {
  const contact=c.guestContact;
  const email=String(contact ? (contact.requested===true ? contact.email||'' : '') : c.wizard?.adults?.[0]?.email||'').trim();
  return validateEmailAddress(email)?email:'';
}

export function reminderDeliveryTarget(c,env,now=new Date()) {
  const email=guestReminderEmail(c);
  if(email)return {channel:'email',to:email,key:'email:'+email};
  const relay=env.AIRBNB_RELAY_REMINDERS==='yes'&&usableAirbnbRelay(c,now);
  if(!relay)return null;
  return {channel:'airbnb_relay',to:relay.to,key:'relay:'+relay.sourceHash,
    subject:/^Re:/i.test(relay.subject)?relay.subject:'Re: '+relay.subject,
    inReplyTo:relay.messageId,references:[relay.messageId]};
}

export function contactPreference(form,now=new Date()) {
  if(form.get('preference')==='airbnb') return {requested:false,updatedAt:now.toISOString()};
  const email=String(form.get('email')||'').trim();
  if(form.get('preference')!=='email'||form.get('requested')!=='yes'||!validateEmailAddress(email)||email!==String(form.get('emailAgain')||'').trim()) return null;
  return {requested:true,email,updatedAt:now.toISOString(),purpose:'hoa-reminders-v1'};
}
