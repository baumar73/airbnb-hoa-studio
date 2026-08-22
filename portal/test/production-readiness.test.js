import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredOwnerEmail, liveSubmissionEnabled, PROPERTY_CONFIG } from '../functions/lib/property-config.js';
import { submissionRecipients } from '../functions/lib/workflow.js';
import { runProductionPreflight } from '../scripts/production_preflight.mjs';

test('production identity is canonical and centralized', () => {
  assert.equal(PROPERTY_CONFIG.portalOrigin, 'https://isladelsol405d.com');
  assert.equal(PROPERTY_CONFIG.listingId, '1097686557541958107');
  assert.equal(PROPERTY_CONFIG.associationName, 'Palma del Mar No. 2 Condominium Association, Inc.');
  assert.equal(PROPERTY_CONFIG.managementName, 'Condominium Associates, Inc.');
  assert.equal(PROPERTY_CONFIG.ownerName, 'Markus Oliver Bauer');
});

test('outbound release boundary is production-state independent', () => {
  assert.equal(liveSubmissionEnabled(), false);
  assert.throws(() => configuredOwnerEmail({}), /required/);
  assert.equal(configuredOwnerEmail({ OWNER_EMAIL: 'owner@example.test' }), 'owner@example.test');
  assert.deepEqual(submissionRecipients(), {
    to: ['info@condominiumassociates.com', 'kruiz@condominiumassociates.com'],
    cc: [],
  });
});

test('deployable runtime contains no review placeholders and keeps release gates closed', async () => {
  const result = await runProductionPreflight();
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.ok(result.checkedRuntimeFiles > 10);
});
