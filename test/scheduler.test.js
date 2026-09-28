import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SESSION_SECRET ||= 'x'.repeat(40);
const { generateSlots, freeInterviewers, pickInterviewers } = await import('../src/scheduler.js');
const { DEFAULT_SETTINGS } = await import('../src/db.js');
const { sign, verify, encrypt, decrypt } = await import('../src/crypto.js');

const settings = { ...DEFAULT_SETTINGS, window_start: '2026-10-05', window_end: '2026-10-06', min_notice_hours: '0' };
const before = new Date('2026-10-01T00:00:00Z');

test('2-hour interviews starting hourly between 9am and 11pm Eastern', () => {
  const slots = generateSlots(settings, before, 'America/New_York');
  assert.equal(slots.length, 26); // 9am..9pm starts = 13 per day, 2 days
  assert.equal(slots[0].start.toISOString(), '2026-10-05T13:00:00.000Z'); // 9:00 EDT
  assert.equal(slots[12].end.toISOString(), '2026-10-06T03:00:00.000Z'); // last ends 11:00 pm EDT
  for (const s of slots) assert.equal(s.end - s.start, 2 * 3600e3);
});

test('minimum notice hides slots that start too soon', () => {
  const now = new Date('2026-10-05T20:00:00Z'); // 4pm EDT
  const slots = generateSlots({ ...settings, min_notice_hours: '2' }, now, 'America/New_York');
  assert.equal(slots[0].start.toISOString(), '2026-10-05T22:00:00.000Z'); // 6pm
});

test('no window set means no slots', () => {
  assert.deepEqual(generateSlots({ ...settings, window_start: '' }, before), []);
});

test('freeInterviewers excludes calendar conflicts and existing interviews', () => {
  const slot = { start: new Date('2026-10-05T21:00:00Z'), end: new Date('2026-10-05T23:00:00Z') };
  const busy = { a: [{ start: new Date('2026-10-05T22:30:00Z'), end: new Date('2026-10-05T23:30:00Z') }], b: [], c: [], d: [] };
  const booked = [{ start_utc: '2026-10-05T20:00:00Z', end_utc: '2026-10-05T22:00:00Z', interviewers: ['b'] }];
  assert.deepEqual(freeInterviewers(slot, ['a', 'b', 'c', 'd'], busy, booked), ['c', 'd']);
});

test('back-to-back is not a conflict', () => {
  const slot = { start: new Date('2026-10-05T21:00:00Z'), end: new Date('2026-10-05T23:00:00Z') };
  const busy = { a: [{ start: new Date('2026-10-05T19:00:00Z'), end: new Date('2026-10-05T21:00:00Z') }] };
  assert.deepEqual(freeInterviewers(slot, ['a'], busy, []), ['a']);
});

test('pickInterviewers prefers philos with fewer interviews', () => {
  assert.deepEqual(pickInterviewers(['a', 'b', 'c'], 2, { a: 3, b: 0, c: 1 }).sort(), ['b', 'c']);
});

test('signed links verify and reject tampering', () => {
  const t = sign({ slackId: 'U1' });
  assert.equal(verify(t).slackId, 'U1');
  assert.equal(verify(t.slice(0, -2) + 'aa'), null);
  assert.equal(verify(sign({ slackId: 'U1' }, -1)), null);
});

test('refresh tokens round-trip through encryption', () => {
  assert.equal(decrypt(encrypt('1//secret')), '1//secret');
});

test('subtractWindow clips merged busy blocks around the interview itself', async () => {
  const { subtractWindow } = await import('../src/scheduler.js');
  const t = (h) => new Date(`2026-10-05T${String(h).padStart(2, '0')}:00:00Z`);
  const merged = [{ start: t(19), end: t(23) }]; // meeting 19-21 + interview 21-23 merged by Google
  assert.deepEqual(subtractWindow(merged, { start: t(21), end: t(23) }), [{ start: t(19), end: t(21) }]);
});

test('verify tolerates junk without throwing', () => {
  assert.equal(verify('e30.ÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿÿ'), null);
  assert.equal(verify('!!!.abc'), null);
});
