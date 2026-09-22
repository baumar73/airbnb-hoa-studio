import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { register } from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);
const { progressBoardView, caseProgress } = await import('../functions/[[path]].js');

function makeCase(id, name, checkIn, checkOut, over = {}) {
  return {
    id, token: 'tok' + id, guestName: name, checkIn, checkOut,
    pathType: 'full', screeningRoute: 'paper', status: null, createdAt: new Date().toISOString(),
    steps: [
      { id: 'forms_sent', label: 'Formulare ausfüllen', done: true, date: checkIn },
      { id: 'screening_complete', label: 'Screening', done: false, date: null },
      { id: 'board_approved', label: 'Board-Freigabe', done: false, date: null },
    ],
    wizard: { savedAt: checkIn, adults: [{ firstName: name.split(' ')[0], lastName: name.split(' ')[1], idNumber: 'ID-' + id }] },
    ...over,
  };
}

test('caseProgress assigns a color and label the admin can read at a glance', () => {
  const approved = makeCase('A', 'Ana Alpha', '2026-11-01', '2026-11-30', { steps: [
    { id: 'forms_sent', label: 'Formulare ausfüllen', done: true, date: null },
    { id: 'screening_complete', label: 'Screening', done: true, date: null },
    { id: 'board_approved', label: 'Board-Freigabe', done: true, date: null },
  ] });
  const p = caseProgress(approved, new Date('2026-10-01T00:00:00Z'));
  assert.equal(p.tone, 'ok');
  assert.match(p.label, /freigegeben|cleared|okay|ok/i);

  const canceled = makeCase('C', 'Carol Canceld', '2026-12-01', '2026-12-20', { status: 'canceled' });
  const c = caseProgress(canceled, new Date('2026-10-01T00:00:00Z'));
  assert.equal(c.tone, 'empty');
  assert.match(c.label, /storniert|canceled/i);

  const missing = makeCase('M', 'Mia Missing', '2026-11-10', '2026-11-25');
  const m = caseProgress(missing, new Date('2026-11-08T00:00:00Z'));
  assert.equal(m.tone, 'crit');
  assert.match(m.label, /Screening|Board|freigabe|approval|fehlt|ausstehend|waiting|offen/i);
});

test('progressBoardView renders one column per tenant sorted chronologically with photo, name, id, and stay dates', () => {
  const cases = [
    makeCase('B', 'Ben Bita', '2026-12-01', '2026-12-20'),
    makeCase('A', 'Ana Alpha', '2026-11-01', '2026-11-30', { photo: 'data:image/png;base64,AAAA', cleaning: '2026-12-01' }),
  ];
  const html = progressBoardView(cases, new Date('2026-10-01T00:00:00Z'));
  // Chronological: the earliest (Ana) must appear before the later (Ben).
  // The column header shows the first name (per spec: "Vorname" under the photo).
  const ia = html.indexOf('Ana'), ib = html.indexOf('Ben');
  assert.ok(ia >= 0 && ib >= 0 && ia < ib, 'earliest tenant rendered leftmost');
  // Each column shows ID and stay data.
  assert.match(html, /ID-A/);
  assert.match(html, /2026-11-01/);   // check-in
  assert.match(html, /2026-11-30/);   // check-out
  assert.match(html, /Reinigung|cleaning|🧹/i);
  assert.match(html, /photo|avatar|\bimg\b|👤/i);
});

test('progressBoardView derives the cleaning date automatically from Turno projects', () => {
  const cases = [makeCase('A', 'Ana Alpha', '2026-11-01', '2026-11-30')];
  const html = progressBoardView(cases, new Date('2026-10-01T00:00:00Z'), [
    { id: 't', projectId: 'T1', date: '2026-12-01', status: 'completed' }, // 2026-11-30 + 1
  ]);
  assert.match(html, /2026-12-01/);
  // Without projects, the manual-empty state is shown instead.
  const nothing = progressBoardView(cases, new Date('2026-10-01T00:00:00Z'), []);
  assert.doesNotMatch(nothing, /2026-12-01/);
});