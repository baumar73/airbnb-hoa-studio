import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);

const cron = (await import('../cron/src/index.js')).default;
const { containsProhibitedSensitiveData } = await import('../functions/lib/hoa-rules.js');

test('scheduled writer purges prohibited legacy data before any KV persistence', async () => {
  const store = new Map();
  store.set('cases', JSON.stringify([{
    id: 'legacy-case',
    guestName: 'Synthetic Guest',
    checkIn: '2026-07-01',
    checkOut: '2026-07-02',
    createdAt: '2026-06-01T00:00:00Z',
    steps: [],
    wizard: {
      adults: [{ firstName: 'Synthetic', birthDate: '2000-01-01', idType: 'passport', idNumber: 'SYNTHETIC-ID' }],
      emergency: [{ name: 'Synthetic Emergency', phone: '555-0100' }],
    },
    metadata: { tenantEvaluationReport: { creditScore: 700 } },
  }]));
  const writes = [];
  const env = {
    CASES: {
      async get(key) { return store.get(key) ?? null; },
      async put(key, value) { writes.push([key, value]); store.set(key, value); },
    },
  };

  await cron.scheduled({ cron: '0 13 * * *' }, env, {});

  assert.ok(writes.some(([key]) => key === 'cases'));
  const persisted = JSON.parse(store.get('cases'));
  assert.equal(containsProhibitedSensitiveData(persisted), false);
  assert.equal(persisted[0].wizard.adults[0].firstName, 'Synthetic');
  assert.equal(persisted[0].wizard.adults[0].birthDate, undefined);
  assert.equal(persisted[0].wizard.adults[0].idType, undefined);
  assert.equal(persisted[0].wizard.adults[0].idNumber, undefined);
  assert.equal(persisted[0].wizard.emergency, undefined);
  assert.equal(persisted[0].metadata.tenantEvaluationReport, undefined);
});