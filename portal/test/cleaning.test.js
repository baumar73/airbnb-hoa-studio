import test from 'node:test';
import assert from 'node:assert/strict';
import { cleaningForCheckout, resolveCleaning, cleaningProjectDate, daysBetween } from '../functions/lib/cleaning.js';

const projects = [
  { id: 't1', projectId: '1', date: '2026-11-01', status: 'completed' },        // matches checkout 2026-10-31 (diff 1)
  { id: 't2', projectId: '2', date: '2026-11-03', status: 'cancelled' },        // cancelled -> ignored
  { id: 't3', projectId: '3', date: '2026-11-10', status: 'scheduled' },        // matches checkout 2026-11-08 (diff 2)
];

test('cleaningForCheckout picks the Turno project 0-2 days after checkout and ignores cancelled', () => {
  assert.equal(cleaningForCheckout('2026-10-31', projects).projectId, '1');
  assert.equal(cleaningForCheckout('2026-11-08', projects).projectId, '3');
  // Too far after, or a cancelled project, yields nothing.
  assert.equal(cleaningForCheckout('2026-11-05', projects), null);
  assert.equal(cleaningForCheckout('2026-11-03', projects), null); // only cancelled falls on this date
  assert.equal(cleaningForCheckout(null, projects), null);
});

test('resolveCleaning prefers the explicit field but derives from Turno projects automatically', () => {
  const c = { checkOut: '2026-10-31', cleaning: '2026-11-01' };
  assert.equal(resolveCleaning(c, []), '2026-11-01', 'explicit wins');
  assert.equal(resolveCleaning({ checkOut: '2026-10-31' }, projects), '2026-11-01', 'derived from projects');
  assert.equal(resolveCleaning({ checkOut: '2026-11-05' }, projects), null, 'no matching project');
  assert.equal(resolveCleaning({ checkOut: '2026-11-03' }, projects), null, 'cancelled project not derived');
});

test('daysBetween is symmetric and expected ', () => {
  assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1);
  assert.equal(daysBetween('2026-11-08', '2026-11-10'), 2);
  assert.equal(daysBetween('2026-11-01', null), null);
});