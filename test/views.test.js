import { test } from 'node:test';
import assert from 'node:assert/strict';
const { slotsPage, interviewPage, icsFile } = await import('../src/views.js');

const slots = [
  { start: new Date('2026-10-05T21:00:00Z'), end: new Date('2026-10-05T23:00:00Z'), free: ['U_SECRET_PHILO'] },
  { start: new Date('2026-10-06T22:00:00Z'), end: new Date('2026-10-07T00:00:00Z'), free: ['U_SECRET_PHILO'] },
];
const iv = { id: 1, status: 'booked', start_utc: '2026-10-05T21:00:00Z', end_utc: '2026-10-05T23:00:00Z', applicant_name: 'Ben <script>', applicant_email: 'b@x.edu', applicant_token: 'tok', interviewers: ['U_SECRET_PHILO'] };

test('applicant list shows times only, never interviewers', () => {
  const html = slotsPage({ slots, open: true });
  assert.match(html, /Monday, October 5/);
  assert.match(html, /5:00 PM/);
  assert.doesNotMatch(html, /U_SECRET_PHILO/);
});

test('confirmation page never names interviewers and escapes input', () => {
  const html = interviewPage({ iv, justBooked: true, location: 'College Hall' });
  assert.doesNotMatch(html, /U_SECRET_PHILO/);
  assert.match(html, /5:00 PM – 7:00 PM/);
  assert.doesNotMatch(interviewPage({ iv: { ...iv, applicant_email: '<b>' }, location: '' }), /<b>/);
});

test('ics file is valid-ish', () => {
  const ics = icsFile(iv, 'College Hall, 4th floor');
  assert.match(ics, /DTSTART:20261005T210000Z/);
  assert.match(ics, /LOCATION:College Hall\\, 4th floor/);
});
