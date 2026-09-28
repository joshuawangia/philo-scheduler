import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
process.env.SESSION_SECRET ||= 'x'.repeat(40);
process.env.TIMEZONE = 'America/New_York';
delete process.env.DIGEST_HOUR;
delete process.env.URGENT_WINDOW_HOURS;
delete process.env.SMTP_URL;
const db = await import('../src/db.js');
const { setTransportForTests } = await import('../src/mailer.js');
const scheduler = await import('../src/scheduler.js');
const runner = await import('../src/digest-runner.js');
const { flush, runDailyIfDue, isUrgent, startDigestRunner, setBuilderForTests } = runner;

db.openDb(':memory:');

// Stub builder: records what it was given, returns a minimal mail.
let builds = [];
const stubBuilder = (args) => {
  builds.push(args);
  return { subject: `${args.urgent ? 'URGENT: ' : ''}digest ${args.events.length}`, text: 't', html: '<p>h</p>', attachments: [] };
};
setBuilderForTests(stubBuilder);

// jsonTransport that counts sends; `failNext` makes the next send throw.
let sent = [];
let failNext = false;
const json = nodemailer.createTransport({ jsonTransport: true });
const transport = {
  async sendMail(msg) {
    if (failNext) {
      failNext = false;
      throw new Error('smtp down');
    }
    await new Promise((r) => setTimeout(r, 10)); // keep the send in flight for a moment
    sent.push(msg);
    return json.sendMail(msg);
  },
};
setTransportForTests(transport);

const iso = (ms) => new Date(ms).toISOString();
const H = 3600e3;
let n = 0;
function book(startMs, interviewers = ['U1']) {
  const id = db.insertInterview({ startUtc: iso(startMs), endUtc: iso(startMs + 2 * H), name: `app${++n}`, email: `a${n}@x.edu`, token: `tok${n}`, interviewers });
  return db.getInterview(id);
}
const clearPending = () => db.markDigestEventsEmailed(db.pendingDigestEvents().map((e) => e.id));
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  clearPending();
  db.setSetting('last_digest_date', '');
  sent = [];
  builds = [];
  failNext = false;
});

test('records booked, cancelled and rescheduled events (with before-detail); non-urgent sends nothing', async () => {
  const r = startDigestRunner();
  try {
    const far = Date.now() + 10 * 24 * H;
    const a = book(far, ['U1', 'U2']);
    const b = book(far + 3 * H);
    scheduler.events.emit('booked', a);
    scheduler.events.emit('cancelled', b, { by: 'applicant' });
    const before = { ...a };
    const moved = { ...a, start_utc: iso(far + 24 * H), end_utc: iso(far + 26 * H), interviewers: ['U3'] };
    scheduler.events.emit('rescheduled', moved, { by: 'UFC', before, conflicts: [], unconnected: [] });

    const p = db.pendingDigestEvents();
    assert.deepEqual(p.map((e) => e.kind), ['booked', 'cancelled', 'rescheduled']);
    assert.deepEqual(p.map((e) => e.interview_id), [a.id, b.id, a.id]);
    assert.equal(p[0].detail, null);
    assert.equal(p[1].detail.by, 'applicant');
    assert.equal(p[2].detail.before_start_utc, a.start_utc);
    assert.equal(p[2].detail.before_end_utc, a.end_utc);
    assert.deepEqual(p[2].detail.before_interviewers, ['U1', 'U2']);
    assert.equal(p[2].detail.by, 'UFC');

    await settle();
    assert.equal(sent.length, 0, 'far-off changes wait for the daily digest');
  } finally {
    r.stop();
  }
});

test('urgent booking sends immediately with URGENT subject and marks events emailed', async () => {
  const r = startDigestRunner();
  try {
    const far = book(Date.now() + 10 * 24 * H);
    scheduler.events.emit('booked', far); // pending, not urgent
    const soon = book(Date.now() + 5 * H);
    scheduler.events.emit('booked', soon);
    await flush(); // waits for the in-flight urgent send
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /^URGENT: digest 2$/);
    assert.equal(sent[0].to, 'firstcensor@philomathean.org');
    assert.equal(builds[0].urgent, true);
    assert.equal(builds[0].events.length, 2, 'urgent flush includes all pending events');
    assert.deepEqual(db.pendingDigestEvents(), []);
  } finally {
    r.stop();
  }
});

test('reschedule is urgent when the previous start was soon, even if the new one is far', async () => {
  const r = startDigestRunner();
  try {
    const iv = book(Date.now() + 3 * H);
    const moved = { ...iv, start_utc: iso(Date.now() + 10 * 24 * H), end_utc: iso(Date.now() + 10 * 24 * H + 2 * H) };
    scheduler.events.emit('rescheduled', moved, { by: 'UFC', before: iv });
    await flush();
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /^URGENT: /);
  } finally {
    r.stop();
  }
});

test('isUrgent: window edges, ongoing, past, previous start', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const ev = (start, end, detail = null) => ({ interview: { start_utc: start, end_utc: end }, detail });
  assert.equal(isUrgent(ev('2026-10-06T11:00:00Z', '2026-10-06T13:00:00Z'), now, 24), true);
  assert.equal(isUrgent(ev('2026-10-06T13:00:00Z', '2026-10-06T15:00:00Z'), now, 24), false);
  assert.equal(isUrgent(ev('2026-10-05T11:00:00Z', '2026-10-05T13:00:00Z'), now, 24), true, 'ongoing');
  assert.equal(isUrgent(ev('2026-10-05T08:00:00Z', '2026-10-05T10:00:00Z'), now, 24), false, 'already over');
  const far = ['2026-10-20T12:00:00Z', '2026-10-20T14:00:00Z'];
  assert.equal(isUrgent(ev(...far, { before_start_utc: '2026-10-05T20:00:00Z', before_end_utc: '2026-10-05T22:00:00Z' }), now, 24), true);
  assert.equal(isUrgent(ev(...far, { before_start_utc: '2026-10-12T20:00:00Z', before_end_utc: '2026-10-12T22:00:00Z' }), now, 24), false);
});

test('daily: not due before digest hour in local time; due at/after it (12:30 UTC = 8:30 EDT)', async () => {
  db.recordDigestEvent({ kind: 'booked', interviewId: book(Date.now() + 10 * 24 * H).id });
  // 11:30 UTC = 7:30 EDT -> not due (would be due if we used UTC hours)
  assert.deepEqual(await runDailyIfDue(new Date('2026-10-05T11:30:00Z')), { due: false });
  assert.equal(sent.length, 0);
  assert.equal(db.getSetting('last_digest_date'), '');

  const r = await runDailyIfDue(new Date('2026-10-05T12:30:00Z'));
  assert.equal(r.due, true);
  assert.equal(r.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(builds[0].urgent, false);
  assert.doesNotMatch(sent[0].subject, /URGENT/);
  assert.equal(db.getSetting('last_digest_date'), '2026-10-05');
  assert.deepEqual(db.pendingDigestEvents(), []);

  // Same local day again: not due, even with new events.
  db.recordDigestEvent({ kind: 'booked', interviewId: book(Date.now() + 11 * 24 * H).id });
  assert.deepEqual(await runDailyIfDue(new Date('2026-10-05T20:00:00Z')), { due: false });
  // 02:00 UTC Oct 6 is still Oct 5 at 10pm EDT.
  assert.deepEqual(await runDailyIfDue(new Date('2026-10-06T02:00:00Z')), { due: false });
  assert.equal(sent.length, 1);
  // Next local day after 8am: due.
  const r2 = await runDailyIfDue(new Date('2026-10-06T13:00:00Z'));
  assert.equal(r2.sent, 1);
  assert.equal(db.getSetting('last_digest_date'), '2026-10-06');
});

test('daily: nothing pending -> no email, but the day is marked done', async () => {
  const r = await runDailyIfDue(new Date('2026-10-07T13:00:00Z'));
  assert.equal(r.due, true);
  assert.equal(sent.length, 0);
  assert.equal(builds.length, 0);
  assert.equal(db.getSetting('last_digest_date'), '2026-10-07');
});

test('daily: send failure leaves events pending and the day unmarked; next tick retries', async () => {
  const e = db.recordDigestEvent({ kind: 'booked', interviewId: book(Date.now() + 10 * 24 * H).id });
  failNext = true;
  const r = await runDailyIfDue(new Date('2026-10-08T13:00:00Z'));
  assert.equal(r.skipped, true);
  assert.deepEqual(db.pendingDigestEvents().map((x) => x.id), [e]);
  assert.equal(db.getSetting('last_digest_date'), '');

  const r2 = await runDailyIfDue(new Date('2026-10-08T13:01:00Z'));
  assert.equal(r2.sent, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(db.pendingDigestEvents(), []);
  assert.equal(db.getSetting('last_digest_date'), '2026-10-08');
});

test('skipped send (no SMTP) leaves events pending', async () => {
  setTransportForTests(null); // SMTP_URL unset -> mailer returns { skipped: true }
  try {
    const e = db.recordDigestEvent({ kind: 'booked', interviewId: book(Date.now() + 10 * 24 * H).id });
    const r = await runDailyIfDue(new Date('2026-10-09T13:00:00Z'));
    assert.equal(r.skipped, true);
    assert.deepEqual(db.pendingDigestEvents().map((x) => x.id), [e]);
    assert.equal(db.getSetting('last_digest_date'), '');
  } finally {
    setTransportForTests(transport);
  }
});

test('builder throwing does not crash and leaves events pending', async () => {
  const e = db.recordDigestEvent({ kind: 'booked', interviewId: book(Date.now() + 10 * 24 * H).id });
  setBuilderForTests(() => {
    throw new Error('bad template');
  });
  try {
    assert.equal((await flush()).skipped, true);
    assert.deepEqual(db.pendingDigestEvents().map((x) => x.id), [e]);
  } finally {
    setBuilderForTests(stubBuilder);
  }
});

test('single-flight: concurrent flushes send one email', async () => {
  db.recordDigestEvent({ kind: 'booked', interviewId: book(Date.now() + 10 * 24 * H).id });
  db.recordDigestEvent({ kind: 'cancelled', interviewId: book(Date.now() + 12 * 24 * H).id });
  const [a, b, c] = await Promise.all([flush(), flush({ urgent: true }), runDailyIfDue(new Date('2026-10-10T13:00:00Z'))]);
  assert.equal(sent.length, 1);
  assert.equal(a.sent, 2);
  assert.equal(b.sent, 2);
  assert.equal(c.due, true);
  assert.deepEqual(db.pendingDigestEvents(), []);
  assert.equal(db.getSetting('last_digest_date'), '2026-10-10');
});

test('timer calls runDailyIfDue and does not hold the process open', async () => {
  db.recordDigestEvent({ kind: 'booked', interviewId: book(Date.now() + 10 * 24 * H).id });
  const r = startDigestRunner({ intervalMs: 5, now: () => new Date('2026-10-11T13:00:00Z') });
  try {
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(db.getSetting('last_digest_date'), '2026-10-11');
  } finally {
    r.stop();
  }
});
