import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
process.env.SESSION_SECRET ||= 'x'.repeat(40);
delete process.env.SMTP_URL;
const db = await import('../src/db.js');
const { sendMail, setTransportForTests } = await import('../src/mailer.js');

db.openDb(':memory:');
const book = (name, start, interviewers) =>
  db.insertInterview({ startUtc: start, endUtc: start.replace('T22', 'T23'), name, email: `${name}@x.edu`, token: `tok-${name}`, interviewers });

test('digest events: record, list pending (hydrated, detail parsed), mark emailed', () => {
  const a = book('ann', '2026-10-05T22:00:00.000Z', ['U1', 'U2']);
  const b = book('bob', '2026-10-06T22:00:00.000Z', ['U3']);
  const detail = { before_start_utc: '2026-10-04T22:00:00.000Z', before_end_utc: '2026-10-04T23:00:00.000Z', before_interviewers: ['U9'] };
  const e1 = db.recordDigestEvent({ kind: 'booked', interviewId: a, occurredAt: '2026-10-01T00:00:00.000Z' });
  const e2 = db.recordDigestEvent({ kind: 'rescheduled', interviewId: b, detail });

  let pending = db.pendingDigestEvents();
  assert.deepEqual(pending.map((e) => e.id), [e1, e2]);
  assert.equal(pending[0].kind, 'booked');
  assert.equal(pending[0].occurred_at, '2026-10-01T00:00:00.000Z');
  assert.equal(pending[0].detail, null);
  assert.equal(pending[0].interview.applicant_name, 'ann');
  assert.deepEqual(pending[0].interview.interviewers.sort(), ['U1', 'U2']);
  assert.deepEqual(pending[1].detail, detail);
  assert.ok(!Number.isNaN(Date.parse(pending[1].occurred_at)));

  db.markDigestEventsEmailed([e1], '2026-10-01T12:00:00.000Z');
  pending = db.pendingDigestEvents();
  assert.deepEqual(pending.map((e) => e.id), [e2]);
  db.markDigestEventsEmailed([e2], new Date().toISOString());
  assert.deepEqual(db.pendingDigestEvents(), []);
  db.markDigestEventsEmailed([], new Date().toISOString()); // no-op
});

test('allInterviews includes cancelled, ordered by start', () => {
  const c = book('cat', '2026-10-01T22:00:00.000Z', ['U1']);
  db.updateInterview(c, { status: 'cancelled' });
  const all = db.allInterviews();
  assert.equal(all[0].applicant_name, 'cat');
  assert.equal(all[0].status, 'cancelled');
  assert.deepEqual(all[0].interviewers, ['U1']);
  const starts = all.map((i) => i.start_utc);
  assert.deepEqual(starts, [...starts].sort());
  assert.ok(all.some((i) => i.status === 'booked'));
});

test('memberNames falls back to slack id when name is missing', () => {
  db.upsertMember({ slackId: 'U1', name: 'Alice' });
  db.upsertMember({ slackId: 'U2' });
  assert.deepEqual(db.memberNames(), { U1: 'Alice', U2: 'U2' });
});

test('last_digest_date setting defaults to empty and round-trips', () => {
  assert.equal(db.getSetting('last_digest_date'), '');
  db.setSetting('last_digest_date', '2026-10-05');
  assert.equal(db.getSetting('last_digest_date'), '2026-10-05');
});

test('sendMail is skipped (and logs) without SMTP_URL', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  setTransportForTests(null);
  assert.deepEqual(await sendMail({ to: 'a@b.c', subject: 'Hello digest', text: 'x' }), { skipped: true });
  assert.ok(log.mock.calls.some((c) => String(c.arguments[0]).includes('Hello digest')));
});

test('sendMail sends through the injected transport', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sent = [];
  const orig = transport.sendMail.bind(transport);
  transport.sendMail = async (msg) => { const info = await orig(msg); sent.push(JSON.parse(info.message)); return info; };
  setTransportForTests(transport);
  try {
    const r = await sendMail({
      to: 'firstcensor@philomathean.org', subject: 'Philo interviews: 1 new', text: 'hi', html: '<p>hi</p>',
      attachments: [{ filename: 'philo-signups-2026-10-05.csv', content: 'status\nbooked\n', contentType: 'text/csv' }],
    });
    assert.ok(r.messageId);
    assert.equal(sent.length, 1);
    const m = sent[0];
    assert.deepEqual(m.to.map((x) => x.address), ['firstcensor@philomathean.org']);
    assert.equal(m.subject, 'Philo interviews: 1 new');
    assert.equal(m.from.address, 'no-reply@philomathean.org');
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0].filename, 'philo-signups-2026-10-05.csv');
  } finally {
    setTransportForTests(null);
  }
});
