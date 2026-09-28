import { test } from 'node:test';
import assert from 'node:assert/strict';
const { buildDigest, toCsv } = await import('../src/digest.js');

const TZ = 'America/New_York';
const NOW = new Date('2026-10-04T12:00:00Z'); // Sun Oct 4, 8:00 AM EDT
const names = { U_ALICE: 'Alice Adams', U_BOB: 'Bob Brown', U_CAROL: 'Carol Chen' };

let nextId = 1;
const iv = (o = {}) => ({
  id: nextId++, status: 'booked', start_utc: '2026-10-05T22:00:00.000Z', end_utc: '2026-10-06T00:00:00.000Z',
  applicant_name: 'Ann Lee', applicant_email: 'ann@x.edu', created_at: '2026-10-03 15:30:00', interviewers: ['U_ALICE', 'U_BOB'], ...o,
});
const ev = (kind, interview, detail = null) => ({ id: nextId++, kind, interview_id: interview?.id ?? 999, occurred_at: NOW.toISOString(), detail, interview });
const build = (o) => buildDigest({ events: [], upcoming: [], all: [], names, now: NOW, tz: TZ, baseUrl: 'https://philo.example', ...o });

test('subject lists non-zero counts and URGENT prefix', () => {
  const a = iv(), b = iv({ applicant_name: 'Bo' }), c = iv({ status: 'cancelled' }), m = iv();
  const events = [ev('booked', a), ev('booked', b), ev('cancelled', c),
    ev('rescheduled', m, { before_start_utc: '2026-10-07T22:00:00.000Z', before_end_utc: '2026-10-08T00:00:00.000Z', before_interviewers: ['U_ALICE', 'U_BOB'] })];
  assert.equal(build({ events }).subject, 'Philo interviews: 2 new, 1 cancelled, 1 moved');
  assert.equal(build({ events: events.slice(0, 1) }).subject, 'Philo interviews: 1 new');
  assert.equal(build({ events: events.slice(2, 3), urgent: true }).subject, 'URGENT: Philo interviews: 1 cancelled');
  assert.match(build({ events, urgent: true }).text, /^URGENT/);
  assert.doesNotMatch(build({ events }).text, /URGENT/);
});

test('sections present/omitted; Next 48 hours always shown', () => {
  const empty = build({});
  assert.doesNotMatch(empty.text, /NEW SIGN-UPS|CHANGES/);
  assert.doesNotMatch(empty.html, /New sign-ups|Changes/);
  assert.match(empty.text, /NEXT 48 HOURS\nNothing scheduled\./);
  assert.match(empty.html, /Next 48 hours<\/h2>\s*<p[^>]*>Nothing scheduled\./);

  const onlyNew = build({ events: [ev('booked', iv())] });
  assert.match(onlyNew.text, /NEW SIGN-UPS \(1\)\n- Ann Lee <ann@x\.edu>\n  Mon Oct 5, 6:00 PM–8:00 PM\n  Interviewers: Alice Adams, Bob Brown/);
  assert.doesNotMatch(onlyNew.text, /CHANGES/);

  const onlyCancel = build({ events: [ev('cancelled', iv({ status: 'cancelled' }))] });
  assert.doesNotMatch(onlyCancel.text, /NEW SIGN-UPS/);
  assert.match(onlyCancel.text, /CHANGES \(1\)\n- CANCELLED: Ann Lee <ann@x\.edu>\n  Was: Mon Oct 5, 6:00 PM–8:00 PM/);
  assert.match(onlyCancel.html, /Changes \(1\)/);
});

test('booked then cancelled in same batch shows only as a cancellation', () => {
  const x = iv({ status: 'cancelled', applicant_name: 'Flaky Fred' });
  const d = build({ events: [ev('booked', x), ev('cancelled', x)] });
  assert.equal(d.subject, 'Philo interviews: 1 cancelled');
  assert.doesNotMatch(d.text, /NEW SIGN-UPS/);
  assert.equal(d.text.match(/Flaky Fred/g).length, 1);
  assert.match(d.text, /CANCELLED: Flaky Fred[\s\S]*Signed up and cancelled/);
});

test('events with a missing interview row are skipped', () => {
  const d = build({ events: [ev('booked', undefined), ev('cancelled', null), ev('booked', iv())] });
  assert.equal(d.subject, 'Philo interviews: 1 new');
  assert.equal(build({ events: [ev('booked', null)] }).subject, 'Philo interviews: no changes');
});

test('moves show old -> new time and interviewer changes by display name', () => {
  const m = iv({ interviewers: ['U_ALICE', 'U_CAROL'] });
  const d = build({ events: [ev('rescheduled', m, { before_start_utc: '2026-10-07T22:00:00.000Z', before_end_utc: '2026-10-08T00:00:00.000Z', before_interviewers: ['U_ALICE', 'U_BOB'] })] });
  assert.match(d.text, /MOVED: Ann Lee <ann@x\.edu>\n  From: Wed Oct 7, 6:00 PM–8:00 PM\n  To:   Mon Oct 5, 6:00 PM–8:00 PM\n  Interviewers: Alice Adams, Bob Brown -> Alice Adams, Carol Chen/);
  assert.match(d.html, /Alice Adams, Bob Brown &rarr; Alice Adams, Carol Chen/);
  // same interviewers: no arrow
  const same = build({ events: [ev('rescheduled', iv(), { before_start_utc: '2026-10-07T22:00:00.000Z', before_end_utc: '2026-10-08T00:00:00.000Z', before_interviewers: ['U_BOB', 'U_ALICE'] })] });
  assert.doesNotMatch(same.text, / -> /);
});

test('interviewer display names used, slack id only as fallback', () => {
  const d = build({ events: [ev('booked', iv({ interviewers: ['U_ALICE', 'U_UNKNOWN'] }))] });
  assert.match(d.text, /Interviewers: Alice Adams, U_UNKNOWN/);
  assert.doesNotMatch(d.text + d.html, /U_ALICE/);
});

test('HTML escapes dynamic values', () => {
  const bad = iv({ applicant_name: '<script>alert("x")</script>', applicant_email: 'a"b@x.edu' });
  const d = build({ events: [ev('booked', bad)], upcoming: [bad], names: { ...names, U_ALICE: '<b>Al</b>' } });
  assert.doesNotMatch(d.html, /<script>|<b>Al/);
  assert.match(d.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(d.html, /a&quot;b@x\.edu/);
  assert.match(d.html, /font-family:'EB Garamond', Garamond, Georgia, serif/);
});

test('tz formatting: UTC renders in America/New_York (EDT and EST)', () => {
  const d = build({ events: [ev('booked', iv({ start_utc: '2026-11-10T23:00:00.000Z', end_utc: '2026-11-11T01:00:00.000Z' }))] });
  assert.match(d.text, /Tue Nov 10, 6:00 PM–8:00 PM/); // EST, UTC-5
  const e = build({ events: [ev('booked', iv({ start_utc: '2026-10-05T13:30:00.000Z', end_utc: '2026-10-05T15:30:00.000Z' }))] });
  assert.match(e.text, /Mon Oct 5, 9:30 AM–11:30 AM/); // EDT, UTC-4
});

test('Next 48 hours window boundaries and sorting', () => {
  const at = (ms, name, status = 'booked') => iv({ applicant_name: name, status, start_utc: new Date(NOW.getTime() + ms).toISOString(), end_utc: new Date(NOW.getTime() + ms + 7200_000).toISOString() });
  const H = 3600_000;
  const upcoming = [at(48 * H + 60_000, 'TooLate'), at(48 * H, 'Edge48'), at(-60_000, 'AlreadyStarted'), at(0, 'RightNow'), at(5 * H, 'Middle'), at(2 * H, 'Gone', 'cancelled')];
  const d = build({ upcoming });
  const sec = d.text.split('NEXT 48 HOURS\n')[1].split('\n\n')[0];
  const listed = sec.split('\n').map((l) => l.match(/: (\w+) \(/)?.[1]);
  assert.deepEqual(listed, ['RightNow', 'Middle', 'Edge48']);
  assert.doesNotMatch(d.html, /TooLate|AlreadyStarted|Gone/);
});

test('footer counts active interviews and links BASE_URL; CSV attached', () => {
  const all = [iv(), iv(), iv({ status: 'cancelled' }), iv({ start_utc: '2026-10-01T22:00:00.000Z', end_utc: '2026-10-02T00:00:00.000Z' })];
  const d = build({ all });
  assert.match(d.text, /2 upcoming interviews booked in total\. Manage: https:\/\/philo\.example/);
  assert.match(d.html, /href="https:\/\/philo\.example"/);
  assert.equal(d.attachments.length, 1);
  assert.equal(d.attachments[0].filename, 'philo-signups-2026-10-04.csv');
  assert.equal(d.attachments[0].contentType, 'text/csv');
  assert.equal(d.attachments[0].content.split('\r\n').filter(Boolean).length, 5);
});

test('CSV: header, local times, quoting, formula-injection guard', () => {
  const rows = [
    iv({ applicant_name: 'Lee, Ann "AJ"', applicant_email: 'ann@x.edu', interviewers: ['U_ALICE', 'U_X'] }),
    iv({ status: 'cancelled', applicant_name: '=HYPERLINK("http://evil")', applicant_email: '@evil', interviewers: [] }),
    iv({ applicant_name: 'Multi\nLine', applicant_email: '+1@x.edu' }),
    iv({ applicant_name: '-2', applicant_email: 'ok@x.edu' }),
  ];
  const lines = toCsv(rows, names, TZ).split('\r\n');
  assert.equal(lines[0], 'status,start,end,applicant_name,applicant_email,interviewers,booked_at');
  assert.equal(lines[1], 'booked,2026-10-05 18:00,2026-10-05 20:00,"Lee, Ann ""AJ""",ann@x.edu,Alice Adams; U_X,2026-10-03 11:30');
  assert.equal(lines[2], `cancelled,2026-10-05 18:00,2026-10-05 20:00,"'=HYPERLINK(""http://evil"")",'@evil,,2026-10-03 11:30`);
  assert.match(lines[3], /^booked,[^\r]*,"Multi\nLine",'\+1@x\.edu,/); // LF stays inside the quoted cell
  assert.match(lines[4], /,'-2,ok@x\.edu,/);
  assert.equal(lines.at(-1), '');
});
