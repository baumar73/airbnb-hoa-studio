import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { adverseActionNotice, liveComplianceState } from '../functions/lib/compliance.js';
import { generateFloodDisclosure } from '../functions/lib/flood.js';
import { getEncryptedSecret, loadStoredCases, putEncryptedSecret, saveStoredCases } from '../functions/lib/storage.js';

function mockEnv() {
  const store = new Map();
  return {
    store,
    env: {
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      AUDIT_HASH_SALT: 'audit-salt-with-at-least-16-characters',
      CASES: {
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, value) { store.set(key, value); },
        async delete(key) { store.delete(key); },
      },
    },
  };
}

function completeConfig() {
  return {
    policyVersion: 'fl-2026.09.02',
    landlordNoticeAddress: 'Owner, 1 Notice Street, St. Petersburg, FL 33715',
    governingDocumentsVerifiedAt: '2026-09-02',
    approvalAuthorityCitation: 'Declaration Article X, Official Records Book/Page',
    feeAuthorityCitation: 'Bylaws Article Y, Official Records Book/Page',
    airbnbFeeDisclosureVerifiedAt: '2026-09-02',
    airbnbExternalFeeAuthorizationReference: 'synthetic documented exception reference',
    rulesVersion: 'Rules adopted 2026-08-01',
    hoaESignAcceptedAt: '2026-09-02',
    privacySecurityReviewedAt: '2026-09-02',
    fairHousingReviewedAt: '2026-09-02',
  };
}

test('live mode fails closed until legal authority and security controls are configured', () => {
  const { env } = mockEnv();
  assert.equal(liveComplianceState({ pathType: 'full', nights: 30 }, completeConfig(), env).ok, true);
  const missingFee = completeConfig();
  delete missingFee.feeAuthorityCitation;
  assert.match(liveComplianceState({ pathType: 'full', nights: 30 }, missingFee, env).missing.join(' '), /fee-authority/i);
  assert.equal(liveComplianceState({ pathType: 'full', nights: 30, applicationType: 'renewal', sameLesseesConfirmed: true }, missingFee, env).ok, true);
});

test('annual rentals require all owner flood answers before live delivery', () => {
  const { env } = mockEnv();
  const config = completeConfig();
  const state = liveComplianceState({ pathType: 'full', nights: 365 }, config, env);
  assert.equal(state.ok, false);
  assert.equal(state.missing.filter(item => item.startsWith('flood disclosure')).length, 3);
});
test('fee disclosure alone does not authorize external collection',()=>{
  const {env}=mockEnv(),config=completeConfig();delete config.airbnbExternalFeeAuthorizationReference;
  assert.match(liveComplianceState({pathType:'full',nights:30},config,env).missing.join(' '),/external.fee/i);
});

test('wizard records and reusable owner signature are encrypted at rest', async () => {
  const { env, store } = mockEnv();
  await saveStoredCases(env, [{ id: 'case-1', guestName: 'Guest', wizard: { adults: [{ idNumber: 'secret-id' }] } }]);
  const raw = store.get('cases');
  assert.doesNotMatch(raw, /secret-id/);
  assert.equal((await loadStoredCases(env))[0].wizard.adults[0].idNumber, 'secret-id');
  await putEncryptedSecret(env, 'owner-signature-png', 'signature-secret');
  assert.doesNotMatch(store.get('secret:owner-signature-png'), /signature-secret/);
  assert.equal(await getEncryptedSecret(env, 'owner-signature-png'), 'signature-secret');
});

test('adverse-action notice contains the FCRA source and dispute rights', () => {
  const notice = adverseActionNotice({ date: '2026-09-02', applicantName: 'Guest', property: 'Unit 405D',
    action: 'application denied', craName: 'Example CRA', craAddress: '1 Report Road', craPhone: '+1 555 000 0000' });
  assert.match(notice, /did not make this decision/i);
  assert.match(notice, /free copy.*within 60 days/i);
  assert.match(notice, /dispute the accuracy or completeness/i);
});

test('annual-rental flood disclosure generates a separate PDF', async () => {
  const bytes = await generateFloodDisclosure({ todayISO: '2026-09-02', landlordNoticeAddress: '1 Notice Street',
    floodDamageKnown: 'no', floodClaimFiled: 'no', floodAssistanceReceived: 'no', adults: [], preview: true });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), 'Florida Flood Disclosure - Unit 405D');
});
