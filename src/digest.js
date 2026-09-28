// Builds the First Censor's digest email (subject, text, HTML, CSV). Pure: no I/O, no DB.
import { DateTime } from 'luxon';
import { config } from './config.js';
import { esc } from './views.js';

const FONT = "'EB Garamond', Garamond, Georgia, serif";
const H2 = 'font-size:18px;font-weight:600;margin:24px 0 8px;border-bottom:1px solid #000;padding-bottom:2px;';
const TABLE = 'border-collapse:collapse;width:100%;font-size:15px;';
const TH = 'text-align:left;font-weight:600;padding:4px 8px 4px 0;border-bottom:1px solid #999;vertical-align:bottom;';
const TD = 'text-align:left;padding:4px 8px 4px 0;border-bottom:1px solid #ddd;vertical-align:top;';

const zoned = (d, tz) => DateTime.fromJSDate(new Date(d), { zone: tz });
const range = (start, end, tz) => `${zoned(start, tz).toFormat('ccc LLL d, h:mm a')}–${zoned(end, tz).toFormat('h:mm a')}`;
const who = (ids, names) => (ids || []).map((id) => names?.[id] || id).join(', ') || '(none)';
const sameSet = (a = [], b = []) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const zoneLabel = (tz, now) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || tz;

// Collapse the pending events to one entry per interview, by its final state.
function summarize(events, names, tz) {
  const byId = new Map();
  for (const e of events || []) {
    if (!e?.interview) continue; // interview row gone: nothing to report
    if (!byId.has(e.interview_id)) byId.set(e.interview_id, { iv: e.interview, kinds: new Set(), moves: [] });
    const g = byId.get(e.interview_id);
    g.kinds.add(e.kind);
    if (e.kind === 'rescheduled' && e.detail) g.moves.push(e.detail);
  }
  const added = [], cancelled = [], moved = [];
  for (const { iv, kinds, moves } of byId.values()) {
    const base = { name: iv.applicant_name, email: iv.applicant_email, when: range(iv.start_utc, iv.end_utc, tz), interviewers: who(iv.interviewers, names) };
    if (iv.status !== 'booked') {
      if (kinds.has('cancelled') || kinds.has('booked')) cancelled.push({ ...base, sameBatch: kinds.has('booked') });
    } else if (kinds.has('booked')) {
      added.push(base);
    } else if (moves.length) {
      const first = moves[0]; // oldest "before" vs the current row
      const staffChanged = Array.isArray(first.before_interviewers) && !sameSet(first.before_interviewers, iv.interviewers);
      moved.push({
        ...base,
        from: first.before_start_utc ? range(first.before_start_utc, first.before_end_utc || first.before_start_utc, tz) : '(unknown)',
        fromInterviewers: staffChanged ? who(first.before_interviewers, names) : null,
      });
    }
  }
  return { added, cancelled, moved };
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// created_at is SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC.
function localStamp(v, tz) {
  if (!v) return '';
  let dt = DateTime.fromSQL(String(v), { zone: 'utc' });
  if (!dt.isValid) dt = DateTime.fromISO(String(v), { zone: 'utc' });
  return dt.isValid ? dt.setZone(tz).toFormat('yyyy-MM-dd HH:mm') : String(v);
}

export function toCsv(all, names, tz = config.timezone) {
  const rows = [['status', 'start', 'end', 'applicant_name', 'applicant_email', 'interviewers', 'booked_at']];
  for (const iv of all || []) {
    rows.push([
      iv.status,
      zoned(iv.start_utc, tz).toFormat('yyyy-MM-dd HH:mm'),
      zoned(iv.end_utc, tz).toFormat('yyyy-MM-dd HH:mm'),
      iv.applicant_name,
      iv.applicant_email,
      (iv.interviewers || []).map((id) => names?.[id] || id).join('; '),
      localStamp(iv.created_at, tz),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function buildDigest({ events, upcoming, all, names, now = new Date(), tz = config.timezone, baseUrl = config.baseUrl, urgent = false }) {
  now = new Date(now);
  const { added, cancelled, moved } = summarize(events, names, tz);
  const horizon = now.getTime() + 48 * 3600_000;
  const soon = (upcoming || [])
    .filter((iv) => iv.status === 'booked')
    .filter((iv) => { const t = Date.parse(iv.start_utc); return t >= now.getTime() && t <= horizon; })
    .sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc))
    .map((iv) => ({ name: iv.applicant_name, email: iv.applicant_email, when: range(iv.start_utc, iv.end_utc, tz), interviewers: who(iv.interviewers, names) }));
  const active = (all || []).filter((iv) => iv.status === 'booked' && Date.parse(iv.end_utc) > now.getTime()).length;

  const counts = [[added.length, 'new'], [cancelled.length, 'cancelled'], [moved.length, 'moved']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`);
  const subject = `${urgent ? 'URGENT: ' : ''}Philo interviews: ${counts.join(', ') || 'no changes'}`;
  const filename = `philo-signups-${zoned(now, tz).toFormat('yyyy-MM-dd')}.csv`;
  const zone = zoneLabel(tz, now);
  const urgentLine = 'URGENT: this includes a change to an interview happening soon.';
  const summary = counts.length ? `Since the last digest: ${counts.join(', ')}.` : 'No changes since the last digest.';
  const footer = `${active} upcoming interview${active === 1 ? '' : 's'} booked in total. Manage: ${baseUrl}`;
  const note = `All times ${zone}. Full list of sign-ups attached (${filename}).`;

  // ---- text ----
  const t = [];
  if (urgent) t.push(urgentLine, '');
  t.push(summary, '');
  if (added.length) {
    t.push(`NEW SIGN-UPS (${added.length})`);
    for (const a of added) t.push(`- ${a.name} <${a.email}>`, `  ${a.when}`, `  Interviewers: ${a.interviewers}`);
    t.push('');
  }
  if (cancelled.length || moved.length) {
    t.push(`CHANGES (${cancelled.length + moved.length})`);
    for (const c of cancelled) {
      t.push(`- CANCELLED: ${c.name} <${c.email}>`, `  Was: ${c.when}`, `  Interviewers: ${c.interviewers}`);
      if (c.sameBatch) t.push('  (Signed up and cancelled since the last digest.)');
    }
    for (const m of moved) {
      t.push(`- MOVED: ${m.name} <${m.email}>`, `  From: ${m.from}`, `  To:   ${m.when}`);
      t.push(m.fromInterviewers ? `  Interviewers: ${m.fromInterviewers} -> ${m.interviewers}` : `  Interviewers: ${m.interviewers}`);
    }
    t.push('');
  }
  t.push('NEXT 48 HOURS');
  if (soon.length) for (const s of soon) t.push(`- ${s.when}: ${s.name} (${s.interviewers})`);
  else t.push('Nothing scheduled.');
  t.push('', '--', footer, note);
  const text = t.join('\n') + '\n';

  // ---- html ----
  const table = (heads, rows) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" style="${TABLE}"><tr>${heads.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((c) => `<td style="${TD}">${c}</td>`).join('')}</tr>`).join('') + '</table>';
  const person = (p) => `${esc(p.name)}<br><span style="font-size:13px;">${esc(p.email)}</span>`;
  const h = [];
  if (urgent) h.push(`<p style="margin:0 0 12px;font-weight:700;">${esc(urgentLine)}</p>`);
  h.push(`<p style="margin:0 0 8px;font-size:17px;">${esc(summary)}</p>`);
  if (added.length) {
    h.push(`<h2 style="${H2}">New sign-ups (${added.length})</h2>`);
    h.push(table(['Applicant', 'When', 'Interviewers'], added.map((a) => [person(a), esc(a.when), esc(a.interviewers)])));
  }
  if (cancelled.length || moved.length) {
    h.push(`<h2 style="${H2}">Changes (${cancelled.length + moved.length})</h2>`);
    const rows = [
      ...cancelled.map((c) => [
        '<strong>Cancelled</strong>',
        person(c),
        `Was ${esc(c.when)}${c.sameBatch ? '<br><em style="font-size:13px;">Signed up and cancelled since the last digest.</em>' : ''}`,
        esc(c.interviewers),
      ]),
      ...moved.map((m) => [
        '<strong>Moved</strong>',
        person(m),
        `From ${esc(m.from)}<br>To ${esc(m.when)}`,
        m.fromInterviewers ? `${esc(m.fromInterviewers)} &rarr; ${esc(m.interviewers)}` : esc(m.interviewers),
      ]),
    ];
    h.push(table(['Change', 'Applicant', 'When', 'Interviewers'], rows));
  }
  h.push(`<h2 style="${H2}">Next 48 hours</h2>`);
  h.push(soon.length
    ? table(['When', 'Applicant', 'Interviewers'], soon.map((s) => [esc(s.when), person(s), esc(s.interviewers)]))
    : '<p style="margin:0;">Nothing scheduled.</p>');
  h.push(`<p style="margin:24px 0 0;font-size:14px;border-top:1px solid #000;padding-top:8px;">${esc(`${active} upcoming interview${active === 1 ? '' : 's'} booked in total.`)} <a href="${esc(baseUrl)}" style="color:#000;">${esc(baseUrl)}</a><br>${esc(note)}</p>`);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;color:#000000;">
<div style="max-width:680px;margin:0 auto;padding:16px;background:#ffffff;color:#000000;font-family:${FONT};font-size:16px;line-height:1.4;">
${h.join('\n')}
</div>
</body></html>`;

  return { subject, text, html, attachments: [{ filename, content: toCsv(all, names, tz), contentType: 'text/csv' }] };
}
