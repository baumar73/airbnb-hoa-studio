import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmHoaOccupancy, parseAdultFormSlots } from '../functions/lib/guest-form.js';

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test('HOA occupancy confirmation keeps Airbnb count while recording adults 18+ and minors', () => {
  const c = { adults: 2 };
  const result = confirmHoaOccupancy(c, { hoaAdults: '1', minors: '1' }, '2026-07-27T12:00:00Z');
  assert.equal(result.ok, true);
  assert.equal(c.airbnbAdults, 2);
  assert.equal(c.adults, 1);
  assert.equal(c.expectedMinors, 1);
  assert.equal(c.hoaOccupancyConfirmedAt, '2026-07-27T12:00:00Z');
});

test('HOA occupancy confirmation rejects impossible automated adult counts', () => {
  const c = { adults: 2 };
  assert.equal(confirmHoaOccupancy(c, { hoaAdults: '0', minors: '2' }, '2026-07-27T12:00:00Z').ok, false);
  assert.equal(confirmHoaOccupancy(c, { hoaAdults: '3', minors: '0' }, '2026-07-27T12:00:00Z').ok, false);
  assert.equal(confirmHoaOccupancy(c, { hoaAdults: '1', minors: '3' }, '2026-07-27T12:00:00Z').ok, false);
});

test('draft parser preserves fixed adult slots even when names are blank', () => {
  const parsed = parseAdultFormSlots(form({ a1_email: 'second@example.com' }), 2);
  assert.equal(parsed.adults.length, 2);
  assert.equal(parsed.adults[0].email, '');
  assert.equal(parsed.adults[1].email, 'second@example.com');
});

test('draft parser keeps signature controls aligned to their original adult slot', () => {
  const parsed = parseAdultFormSlots(form({ a1_remove_sig: 'yes', a1_esign_consent: 'yes' }), 2);
  assert.deepEqual(parsed.removeSigs, [false, true]);
  assert.equal(parsed.adults[0].esignConsent, false);
  assert.equal(parsed.adults[1].esignConsent, true);
});
