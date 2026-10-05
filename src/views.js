import { DateTime } from 'luxon';
import { config } from './config.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · The Philomathean Society</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
<header><a href="/"><img src="/logo.jpg" alt="The Philomathean Society of the University of Pennsylvania"></a></header>
${body}
</main>
</body>
</html>`;
}

const zoneLabel = () =>
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || config.timezone;
const zoned = (d) => DateTime.fromJSDate(new Date(d), { zone: config.timezone });

export function slotsPage({ slots, error, values = {}, open }) {
  if (!open) return layout('Interviews', `<h1>Interviews</h1><p class="note">Interview sign-ups are not open right now. Please check back soon.</p>`);
  if (!slots.length)
    return layout('Interviews', `<h1>Interviews</h1><p class="note">There are no interview times available at the moment. Please check back soon.</p>`);

  const byDay = new Map();
  for (const s of slots) {
    const key = zoned(s.start).toISODate();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }
  const days = [...byDay.entries()]
    .map(
      ([day, list]) => `
    <fieldset class="day">
      <legend>${esc(DateTime.fromISO(day).toFormat('cccc, LLLL d'))}</legend>
      <div class="times">
        ${list
          .map((s) => {
            const v = s.start.toISOString();
            return `<label><input type="radio" name="start" value="${v}" required${values.start === v ? ' checked' : ''}><span>${esc(zoned(s.start).toFormat('h:mm a'))}</span></label>`;
          })
          .join('')}
      </div>
    </fieldset>`,
    )
    .join('');

  return layout(
    'Interviews',
    `<h1>Interviews</h1>
<p class="note">Choose one time below. All times are ${esc(zoneLabel())}.</p>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/book">
  <div class="fields">
    <label>Name<input name="name" autocomplete="name" required maxlength="120" value="${esc(values.name)}"></label>
    <label>Email<input name="email" type="email" autocomplete="email" required maxlength="200" value="${esc(values.email)}"></label>
  </div>
  ${days}
  <button type="submit">Reserve</button>
</form>`,
  );
}

export function interviewPage({ iv, justBooked, location }) {
  if (iv.status !== 'booked')
    return layout('Cancelled', `<h1>Cancelled</h1><p class="note">This interview has been cancelled.</p><p><a href="/">Choose a new time</a></p>`);
  return layout(
    'Your interview',
    `<h1>${justBooked ? 'You are scheduled' : 'Your interview'}</h1>
<p class="when">${esc(zoned(iv.start_utc).toFormat("cccc, LLLL d"))}<br>${esc(zoned(iv.start_utc).toFormat('h:mm a'))} – ${esc(zoned(iv.end_utc).toFormat('h:mm a'))}</p>
<p class="note">${esc(location)}</p>
<p class="cal"><a href="${esc(googleCalUrl(iv, location))}" target="_blank" rel="noopener">Add to Google Calendar</a> · <a href="/a/${esc(iv.applicant_token)}/interview.ics">Download .ics</a></p>
<p class="note">Bookmark this page. It is how you cancel or choose another time.</p>
<form method="post" action="/a/${esc(iv.applicant_token)}/cancel" class="quiet">
  <button type="submit">Cancel this interview</button>
</form>`,
  );
}

const gcalStamp = (d) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, '');
function googleCalUrl(iv, location) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: 'Philomathean Society Interview', dates: `${gcalStamp(iv.start_utc)}/${gcalStamp(iv.end_utc)}`, location, details: `Manage: ${config.baseUrl}/a/${iv.applicant_token}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function icsFile(iv, location) {
  const e = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Philomathean Society//Interviews//EN', 'BEGIN:VEVENT',
    `UID:interview-${iv.id}@philo-scheduler`, `DTSTAMP:${gcalStamp(new Date())}`,
    `DTSTART:${gcalStamp(iv.start_utc)}`, `DTEND:${gcalStamp(iv.end_utc)}`,
    'SUMMARY:Philomathean Society Interview', `LOCATION:${e(location)}`, `DESCRIPTION:${e(`Manage: ${config.baseUrl}/a/${iv.applicant_token}`)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export const messagePage = (title, text) => layout(title, `<h1>${esc(title)}</h1><p class="note">${esc(text)}</p>`);

// Setup checklist for first-time installs. Shows setting names and ✅/❌ only, never values.
export function setupPage({ checks, address, baseUrlSet = true, manifest = '' }) {
  const rows = checks
    .map((c) => {
      const hint = c.name === 'BASE_URL' && !baseUrlSet ? `Copy this exact address into Railway as BASE_URL: ${address}` : c.hint;
      const mark = c.ok ? '✅' : c.required ? '❌' : '⚠️';
      return `<li><span class="mark">${mark}</span> <strong>${esc(c.name)}</strong>${c.required ? '' : ' <em>(optional)</em>'}<br><span class="hint">${esc(hint)}</span>${!c.ok && c.warn ? `<br><span class="hint"><em>${esc(c.warn)}</em></span>` : ''}</li>`;
    })
    .join('');
  const pastes = [
    ['Google → Authorized redirect URI', `${address}/oauth/google/callback`, 1],
    ['Slack → Create app → From a manifest (YAML)', manifest.replace(/^(#.*\n)+/, '').replaceAll('https://philo-interviews.example.com', address), 24],
    ['Applicant link', address, 1],
  ]
    .map(([label, text, lines], i) => `
<div class="paste">
  <label for="p${i}">${esc(label)}</label>
  <textarea id="p${i}" readonly rows="${lines}">${esc(text)}</textarea>
  <button type="button" data-copy="p${i}">Copy</button>
</div>`)
    .join('');
  const blocking = checks.some((c) => c.required && !c.ok);
  return layout(
    'Setup checklist',
    `<style>
.checklist { list-style: none; padding: 0; margin: 24px 0 40px; }
.checklist li { margin: 0 0 16px; }
.checklist .hint { font-size: 16px; }
.paste { margin: 0 0 32px; }
.paste label { display: block; font-variant: small-caps; letter-spacing: 0.05em; border-bottom: 1px solid #000; margin-bottom: 8px; }
.paste textarea { width: 100%; font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; border: 1px solid #000; border-radius: 0; padding: 8px; color: #000; background: #fff; resize: vertical; }
.paste button { margin: 8px 0 0; font-size: 16px; padding: 2px 16px; }
h2 { font-weight: 400; font-size: 24px; text-align: center; margin: 40px 0 16px; }
</style>
<h1>Setup checklist</h1>
<p class="note">${blocking ? 'A few settings are missing or wrong. Add them where you host the app (for example Railway → Variables), click Deploy in Railway, then refresh this page.' : 'Everything required is set.'}</p>
<ul class="checklist">${rows}</ul>
<h2>Copy and paste</h2>
${pastes}
<script>
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var t = document.getElementById(b.getAttribute('data-copy'));
    t.select();
    var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) {} });
    else { try { document.execCommand('copy'); done(); } catch (e) {} }
  });
});
</script>`,
  );
}
