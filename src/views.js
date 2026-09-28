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
