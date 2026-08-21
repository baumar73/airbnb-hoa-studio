import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOA_RULE_REGISTRY,
  classifyOccupancy,
  evaluateApplicationFee,
  evaluateOccupancyLimit,
  evaluatePetRule,
  containsProhibitedSensitiveData,
  stripProhibitedSensitiveData,
} from '../functions/lib/hoa-rules.js';

test('owner-present friends or company are not guest-registration cases', () => {
  const result = classifyOccupancy({ ownerPresent: true, compensation: false, stayNights: 7 });
  assert.equal(result.kind, 'owner_present_visit');
  assert.equal(result.registrationRequired, false);
});

test('compensation always routes away from guest registration', () => {
  const result = classifyOccupancy({ ownerPresent: false, compensation: true, stayNights: 29 });
  assert.equal(result.kind, 'rental');
  assert.equal(result.registrationRequired, false);
});

test('uncompensated owner-absent stays below 30 nights are guests', () => {
  const result = classifyOccupancy({ ownerPresent: false, compensation: false, stayNights: 29 });
  assert.equal(result.kind, 'guest');
  assert.equal(result.registrationRequired, true);
});

test('occupancy classification requires explicit owner-presence and compensation facts', () => {
  assert.equal(classifyOccupancy({ stayNights: 29 }).kind, 'clarification_required');
  assert.equal(classifyOccupancy({ ownerPresent: false, stayNights: 29 }).kind, 'clarification_required');
});

test('exactly 30 nights fails closed because one-month and 30-day texts conflict', () => {
  const result = classifyOccupancy({ ownerPresent: false, compensation: false, stayNights: 30 });
  assert.equal(result.kind, 'clarification_required');
  assert.equal(result.checkInLocked, true);
  assert.deepEqual(result.sourceIds.sort(), ['CINC-363471', 'CINC-364605']);
});

test('current association fee is separate from statutory maximum and authority evidence', () => {
  const guestFee = evaluateApplicationFee({ kind: 'guest' });
  assert.equal(guestFee.status, 'not_required');
  assert.equal(guestFee.amount, 0);
  assert.equal(guestFee.currentAssociationAmount, 100);
  assert.equal(guestFee.statutoryMaximum, 150);
  assert.equal(evaluateApplicationFee({ kind: 'rental', sameLesseeRenewalClaimed: true, sameLesseeRenewalVerified: true }).amount, 0);
  const blocked = evaluateApplicationFee({ kind: 'rental', sameLesseeRenewal: false, governingAuthorityVerified: false });
  assert.equal(blocked.status, 'clarification_required');
  assert.equal(blocked.amount, null);
  const allowed = evaluateApplicationFee({ kind: 'rental', sameLesseeRenewal: false, governingAuthorityVerified: true });
  assert.equal(allowed.status, 'required');
  assert.equal(allowed.amount, 100);
  assert.equal(allowed.statutoryMaximum, 150);
});

test('occupancy limits are bedroom-specific and unknown bedroom count fails closed', () => {
  assert.equal(evaluateOccupancyLimit({ bedrooms: 1, occupants: 4 }).allowed, true);
  assert.equal(evaluateOccupancyLimit({ bedrooms: 1, occupants: 5 }).allowed, false);
  assert.equal(evaluateOccupancyLimit({ bedrooms: 2, occupants: 6 }).allowed, true);
  assert.equal(evaluateOccupancyLimit({ bedrooms: 2, occupants: 7 }).allowed, false);
  assert.equal(evaluateOccupancyLimit({ bedrooms: null, occupants: 4 }).status, 'clarification_required');
});

test('renter and guest pets are blocked but accommodation requests route to human review', () => {
  assert.equal(evaluatePetRule({ occupancyKind: 'rental', accommodationRequested: false }).status, 'prohibited');
  assert.equal(evaluatePetRule({ occupancyKind: 'guest', accommodationRequested: true }).status, 'accommodation_review');
  assert.equal(evaluatePetRule({ occupancyKind: 'owner', accommodationRequested: false }).status, 'clarification_required');
});

test('sensitive screening data is detected and removed recursively', () => {
  const payload = {
    firstName: 'Synthetic',
    birthDate: '2000-01-01',
    nested: { idNumber: 'SYNTHETIC-ID', employer: 'Synthetic Employer', safeStatus: 'vendor_pending' },
    list: [{ criminalHistory: 'none' }, { vendorReference: 'synthetic-reference' }],
  };
  assert.equal(containsProhibitedSensitiveData(payload), true);
  const cleaned = stripProhibitedSensitiveData(payload);
  assert.deepEqual(cleaned, {
    firstName: 'Synthetic',
    nested: { safeStatus: 'vendor_pending' },
    list: [{}, { vendorReference: 'synthetic-reference' }],
  });
});

test('SSN and labelled sensitive free-text patterns are detected and redacted recursively', () => {
  const payload = { notes: [
    'ordinary',
    'do not store 123-45-6789',
    'SSN: 123 45 6789',
    'passport number: SYNTHETIC-123',
    'credit score = 700',
    'taxpayer identification number: SYNTHETIC-999',
    'financial information: SYNTHETIC-ACCOUNT',
    'screening report: SYNTHETIC-REPORT',
    'emergency contact: SYNTHETIC-PERSON',
  ] };
  assert.equal(containsProhibitedSensitiveData(payload), true);
  const clean = stripProhibitedSensitiveData(payload);
  assert.equal(containsProhibitedSensitiveData(clean), false);
  assert.equal(clean.notes[0], 'ordinary');
  assert.ok(clean.notes.slice(1).every(value => value === '[REDACTED PROHIBITED SENSITIVE DATA]'));
});

test('rule registry preserves source version, authority, and unresolved conflicts', () => {
  assert.equal(HOA_RULE_REGISTRY.version, '2026-08-21-corpus-review');
  assert.ok(HOA_RULE_REGISTRY.rules.every(rule => rule.sourceIds?.length));
  assert.ok(HOA_RULE_REGISTRY.rules.some(rule => rule.status === 'unresolved'));
  assert.ok(HOA_RULE_REGISTRY.rules.some(rule => rule.sourceIds.includes('CINC-364605')));
  const decisions = [
    classifyOccupancy({ ownerPresent: false, compensation: true, stayNights: 45 }),
    classifyOccupancy({ ownerPresent: false, compensation: false, stayNights: 30 }),
    evaluateApplicationFee({ kind: 'rental', governingAuthorityVerified: true }),
    evaluateOccupancyLimit({ bedrooms: 1, occupants: 4 }),
    evaluatePetRule({ occupancyKind: 'guest', accommodationRequested: true }),
  ];
  assert.ok(decisions.every(decision => decision.ruleVersionId?.startsWith(`${HOA_RULE_REGISTRY.version}:`)));
  assert.ok(decisions.every(decision => decision.ruleStatus && decision.sourceIds?.length));
  assert.equal(decisions[1].ruleStatus, 'unresolved');
  assert.ok(decisions[4].sourceIds.includes('LEGAL-us-42-3604-fair-housing'));
});
