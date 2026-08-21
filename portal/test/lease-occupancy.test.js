import test from 'node:test';
import assert from 'node:assert/strict';
import { occupancyClause } from '../functions/lib/lease.js';

test('lease occupancy clause names minor occupants without making them signing tenants', () => {
  assert.equal(
    occupancyClause({ children: [{ name: 'DemoNameR DemoSurnameE', birthDate: '2009-01-01' }] }),
    'Occupancy is limited to the registered Airbnb guest(s), approved adult occupants, and the following approved minor occupant(s): DemoNameR DemoSurnameE. Subletting or assignment is prohibited.',
  );
});

test('lease occupancy clause stays concise when there are no minors', () => {
  assert.equal(
    occupancyClause({ children: [] }),
    'Occupancy is limited to the registered Airbnb guest(s) and approved adult occupants. Subletting or assignment is prohibited.',
  );
});
