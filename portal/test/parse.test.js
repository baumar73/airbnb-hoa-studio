import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooking, parseCancellation, parseDates } from '../functions/lib/parse.js';

const demoGuestMail = {
  subject: 'Reservation confirmed - DemoGuest DemoNameL arrives Oct 17',
  text: `NEW BOOKING CONFIRMED! DEMOGUEST ARRIVES OCT 17.
Check-in Checkout
Sat, Oct 17 Sun, Dec 20
3:00 PM 3:00 PM
GUESTS
1 adult
HMDEMO0002
64 nights room fee`,
};

test('parses the real DemoGuest booking range and singular adult count', () => {
  assert.deepEqual(parseBooking(demoGuestMail, '2026-07-17'), {
    code: 'HMDEMO0002',
    guestName: 'DemoGuest DemoNameL',
    checkIn: '2026-10-17',
    checkOut: '2026-12-20',
    adults: 1,
    complete: true,
  });
});

test('parses an Airbnb cancellation only when a reservation code is present', () => {
  assert.deepEqual(parseCancellation({
    subject: 'Canceled: Reservation HMDEMO0002 for Oct 17 – Dec 20, 2026',
    text: 'RESERVATION CANCELED',
    date: '2026-07-18T17:54:19Z',
  }), { code: 'HMDEMO0002', canceledAt: '2026-07-18T17:54:19Z', complete: true });
  assert.equal(parseCancellation({ subject: 'Cancellation policy update', text: 'No reservation code' }).complete, false);
});

test('prioritizes the labelled Airbnb stay range over unrelated dates in the message', () => {
  const mail = {
    ...demoGuestMail,
    text: `Booked on Jul 17, 2026.\n${demoGuestMail.text}\nCancellation deadline Jul 19, 2026.`,
  };
  const parsed = parseBooking(mail, '2026-07-17');
  assert.equal(parsed.checkIn, '2026-10-17');
  assert.equal(parsed.checkOut, '2026-12-20');
});

test('preserves explicit date order instead of sorting unrelated dates', () => {
  assert.deepEqual(
    parseDates('Checkout Dec 20, 2026 after check-in Oct 17, 2026'),
    ['2026-12-20', '2026-10-17'],
  );
});

test('does not silently guess two adults when the count is absent', () => {
  const parsed = parseBooking({ ...demoGuestMail, text: demoGuestMail.text.replace('GUESTS\n1 adult', 'GUESTS') }, '2026-07-17');
  assert.equal(parsed.adults, null);
  assert.equal(parsed.complete, false);
});

test('rejects impossible calendar dates', () => {
  const parsed = parseBooking({
    subject: 'Reservation confirmed - Jane Doe',
    text: 'Check-in Checkout\nFeb 31, 2027 Mar 5, 2027\nGUESTS\n1 adult\nHMABCDEF1234',
  }, '2026-07-17');
  assert.equal(parsed.complete, false);
});

test('supports plural adult counts and a year-crossing stay', () => {
  const parsed = parseBooking({
    subject: 'Reservation confirmed - Jane Doe arrives Dec 20',
    text: 'Check-in Checkout\nSun, Dec 20 Tue, Jan 5\nGUESTS\n2 adults\nHMABCDEF1234',
  }, '2026-07-17');
  assert.equal(parsed.checkIn, '2026-12-20');
  assert.equal(parsed.checkOut, '2027-01-05');
  assert.equal(parsed.adults, 2);
  assert.equal(parsed.complete, true);
});
