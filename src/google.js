import { calendar as gcal, auth } from '@googleapis/calendar';
import { config } from './config.js';
import { decrypt } from './crypto.js';

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy', // read busy/free only, never event details
  'https://www.googleapis.com/auth/calendar.events', // create/update the interview events
];

const redirectUri = () => `${config.baseUrl}/oauth/google/callback`;
const newClient = () => new auth.OAuth2(config.google.clientId, config.google.clientSecret, redirectUri());

export function authUrl(state) {
  return newClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
}

// Exchange the OAuth code for tokens; returns { refreshToken, email }.
export async function exchangeCode(code) {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  let email = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
    email = ticket.getPayload().email;
  }
  return { refreshToken: tokens.refresh_token, email };
}

function calendarFor(member) {
  const client = newClient();
  client.setCredentials({ refresh_token: decrypt(member.refresh_token) });
  return gcal({ version: 'v3', auth: client });
}

// Busy intervals on the philo's primary calendar, as [{start: Date, end: Date}].
export async function busyTimes(member, timeMin, timeMax) {
  const res = await calendarFor(member).freebusy.query({
    requestBody: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: 'primary' }] },
  });
  const cal = res.data.calendars?.primary;
  if (cal?.errors?.length) throw new Error(`freebusy error: ${JSON.stringify(cal.errors)}`);
  return (cal?.busy || []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

function eventBody(iv, attendeeEmails) {
  return {
    summary: `Philomathean Interview: ${iv.applicant_name}`,
    location: iv.location,
    description: `Interview with ${iv.applicant_name} <${iv.applicant_email}>.\nThe applicant is not on this invite. Contact the First Censor to change it.`,
    start: { dateTime: iv.start_utc, timeZone: config.timezone },
    end: { dateTime: iv.end_utc, timeZone: config.timezone },
    attendees: attendeeEmails.filter(Boolean).map((email) => ({ email })),
    reminders: { useDefault: true },
  };
}

export async function createEvent(organizer, iv, attendeeEmails) {
  const res = await calendarFor(organizer).events.insert({ calendarId: 'primary', sendUpdates: 'all', requestBody: eventBody(iv, attendeeEmails) });
  return res.data.id;
}

export async function updateEvent(organizer, eventId, iv, attendeeEmails) {
  await calendarFor(organizer).events.patch({ calendarId: 'primary', eventId, sendUpdates: 'all', requestBody: eventBody(iv, attendeeEmails) });
}

export async function deleteEvent(organizer, eventId) {
  try {
    await calendarFor(organizer).events.delete({ calendarId: 'primary', eventId, sendUpdates: 'all' });
  } catch (e) {
    if (![404, 410].includes(e.code)) throw e; // already gone is fine
  }
}
