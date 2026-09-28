import { EventEmitter } from 'node:events';
import { DateTime } from 'luxon';
import { config } from './config.js';
import * as db from './db.js';
import * as google from './google.js';
import { randomToken } from './crypto.js';

// Emits 'booked' | 'cancelled' | 'rescheduled' with (interview, meta) so Slack can notify people.
export const events = new EventEmitter();

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// ---- pure helpers (unit-tested) ----

// Every candidate slot inside the interview window, in UTC Dates.
export function generateSlots(settings, now = new Date(), tz = config.timezone) {
  const { window_start, window_end, day_start, day_end } = settings;
  const minutes = Number(settings.slot_minutes);
  const step = Number(settings.step_minutes) || minutes;
  if (!window_start || !window_end || !(minutes > 0) || !(step > 0)) return [];
  const earliest = now.getTime() + Number(settings.min_notice_hours || 0) * 3600e3;
  const slots = [];
  let day = DateTime.fromISO(window_start, { zone: tz });
  const last = DateTime.fromISO(window_end, { zone: tz });
  while (day <= last) {
    const [sh, sm] = day_start.split(':').map(Number);
    const [eh, em] = day_end.split(':').map(Number);
    let t = day.set({ hour: sh, minute: sm });
    const stop = day.set({ hour: eh, minute: em });
    while (t.plus({ minutes }) <= stop) {
      if (t.toMillis() >= earliest) slots.push({ start: t.toJSDate(), end: t.plus({ minutes }).toJSDate() });
      t = t.plus({ minutes: step });
    }
    day = day.plus({ days: 1 });
  }
  return slots;
}

// For each slot, which philos are free (no calendar conflict and not already interviewing).
export function freeInterviewers(slot, memberIds, busyByMember, booked) {
  return memberIds.filter((id) => {
    if ((busyByMember[id] || []).some((b) => overlaps(b, slot))) return false;
    return !booked.some((iv) => iv.interviewers.includes(id) && overlaps({ start: new Date(iv.start_utc), end: new Date(iv.end_utc) }, slot));
  });
}

// Pick the least-loaded free philos (ties broken randomly so nobody is always first).
export function pickInterviewers(free, needed, loads, rand = Math.random) {
  return free
    .map((id) => ({ id, load: loads[id] || 0, r: rand() }))
    .sort((a, b) => a.load - b.load || a.r - b.r)
    .slice(0, needed)
    .map((x) => x.id);
}

// ---- availability (reads Google Calendar, cached briefly) ----

let cache = { at: 0, data: null };
const CACHE_MS = 2 * 60 * 1000;
export const invalidate = () => (cache = { at: 0, data: null });

async function fetchBusy(members, timeMin, timeMax) {
  const out = {};
  await Promise.all(
    members.map(async (m) => {
      try {
        out[m.slack_id] = await google.busyTimes(m, timeMin, timeMax);
      } catch (e) {
        console.error(`[gcal] could not read calendar for ${m.slack_id}: ${e.message}`);
        out[m.slack_id] = [{ start: timeMin, end: timeMax }]; // unknown => treat as busy
      }
    }),
  );
  return out;
}

// Returns [{ start, end, free: [slackIds] }] for slots that can currently be booked.
export async function openSlots({ fresh = false } = {}) {
  if (!fresh && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const settings = db.getSettings();
  const slots = generateSlots(settings);
  const perSlot = Number(settings.interviewers_per_slot) || 1;
  const members = db.connectedMembers();
  let result = [];
  if (slots.length && members.length >= perSlot) {
    const timeMin = slots[0].start;
    const timeMax = slots[slots.length - 1].end;
    const busy = await fetchBusy(members, timeMin, timeMax);
    const booked = db.bookedBetween(timeMin.toISOString(), timeMax.toISOString());
    const ids = members.map((m) => m.slack_id);
    result = slots
      .map((s) => ({ ...s, free: freeInterviewers(s, ids, busy, booked) }))
      .filter((s) => s.free.length >= perSlot);
  }
  cache = { at: Date.now(), data: result };
  return result;
}

// Fresh availability for a single slot (used at booking time, so only a tiny window is queried).
async function freeForSlot(slot) {
  const members = db.connectedMembers();
  const busy = await fetchBusy(members, slot.start, slot.end);
  const booked = db.bookedBetween(slot.start.toISOString(), slot.end.toISOString());
  return freeInterviewers(slot, members.map((m) => m.slack_id), busy, booked);
}

// Busy blocks with one time window cut out (Google merges adjacent blocks, so we clip rather than drop).
export function subtractWindow(blocks, win) {
  const out = [];
  for (const b of blocks) {
    if (!overlaps(b, win)) out.push(b);
    else {
      if (b.start < win.start) out.push({ start: b.start, end: win.start });
      if (b.end > win.end) out.push({ start: win.end, end: b.end });
    }
  }
  return out;
}

// ---- mutations ----

export class BookingError extends Error {}

// Only philos are invited. The applicant is deliberately left off so they never see who is interviewing them;
// they get an "add to calendar" link on their confirmation page instead.
function attendeeEmails(interviewerIds) {
  return interviewerIds.map((id) => db.getMember(id)?.email);
}

export async function book({ startIso, name, email }) {
  name = String(name).trim().slice(0, 120);
  email = String(email).trim().slice(0, 200);
  const settings = db.getSettings();
  if (settings.booking_open !== '1') throw new BookingError('Interview booking is currently closed.');
  const existing = db.activeInterviewByEmail(email);
  if (existing) throw new BookingError('You already have an interview booked. Use the link from your confirmation to change it.');

  // Only accept a start time the page could have offered.
  const candidate = generateSlots(settings).find((s) => s.start.toISOString() === startIso);
  if (!candidate) throw new BookingError('Sorry, that time is no longer available. Please choose another.');
  const slot = { ...candidate, free: await freeForSlot(candidate) };

  const perSlot = Number(settings.interviewers_per_slot) || 1;
  // Synchronous block: re-check against the DB and insert atomically.
  const id = db.tx(() => {
    if (db.activeInterviewByEmail(email)) throw new BookingError('You already have an interview booked. Use the link from your confirmation to change it.');
    const booked = db.bookedBetween(slot.start.toISOString(), slot.end.toISOString());
    const stillFree = slot.free.filter((sid) => !booked.some((iv) => iv.interviewers.includes(sid)));
    if (stillFree.length < perSlot) throw new BookingError('Sorry, that time was just taken. Please choose another.');
    const interviewers = pickInterviewers(stillFree, perSlot, db.loadCounts());
    return db.insertInterview({ startUtc: slot.start.toISOString(), endUtc: slot.end.toISOString(), name, email, token: randomToken(), interviewers });
  });

  const iv = db.getInterview(id);
  try {
    const organizer = db.getMember(iv.interviewers[0]);
    const eventId = await google.createEvent(organizer, { ...iv, location: settings.location }, attendeeEmails(iv.interviewers));
    db.updateInterview(id, { eventId });
  } catch (e) {
    db.deleteInterview(id);
    console.error('[gcal] event creation failed', e);
    throw new BookingError('We could not create the calendar invitation. Please try again in a minute.');
  } finally {
    invalidate();
  }
  const done = db.getInterview(id);
  events.emit('booked', done);
  return done;
}

export async function cancel(id, { by } = {}) {
  const iv = db.getInterview(id);
  if (!iv || iv.status !== 'booked') throw new BookingError('That interview is not active.');
  const organizer = db.getMember(iv.organizer_slack_id);
  if (iv.event_id && organizer?.refresh_token) {
    try {
      await google.deleteEvent(organizer, iv.event_id);
    } catch (e) {
      console.error(`[gcal] could not delete event for interview ${id}: ${e.message}`);
    }
  }
  db.updateInterview(id, { status: 'cancelled' });
  invalidate();
  events.emit('cancelled', iv, { by });
  return iv;
}

// First Censor override: move an interview and/or change who conducts it.
// Does not block on calendar conflicts; returns the names of philos who look busy.
export async function reschedule(id, { startIso, interviewers, by }) {
  const iv = db.getInterview(id);
  if (!iv || iv.status !== 'booked') throw new BookingError('That interview is not active.');
  const settings = db.getSettings();
  const durationMs = new Date(iv.end_utc) - new Date(iv.start_utc);
  const start = startIso ? new Date(startIso) : new Date(iv.start_utc);
  const end = new Date(start.getTime() + durationMs);
  const newIds = interviewers?.length ? interviewers : iv.interviewers;

  const members = newIds.map((sid) => db.getMember(sid));
  const unconnected = newIds.filter((sid, i) => !members[i]?.refresh_token);
  if (unconnected.length === newIds.length) throw new BookingError('At least one interviewer must have connected Google Calendar.');

  // Conflict warnings (ignore this interview's own event).
  const others = db.bookedBetween(start.toISOString(), end.toISOString()).filter((o) => o.id !== id);
  const conflicts = [];
  for (const m of members.filter((m) => m?.refresh_token)) {
    let busy = [];
    try {
      busy = await google.busyTimes(m, start, end);
    } catch {}
    const ownEvent = { start: new Date(iv.start_utc), end: new Date(iv.end_utc) };
    const realBusy = iv.interviewers.includes(m.slack_id) ? subtractWindow(busy, ownEvent) : busy;
    if (realBusy.some((b) => overlaps(b, { start, end })) || others.some((o) => o.interviewers.includes(m.slack_id))) conflicts.push(m.slack_id);
  }

  const updated = { ...iv, start_utc: start.toISOString(), end_utc: end.toISOString(), location: settings.location };
  const emails = attendeeEmails(newIds);
  const oldOrganizer = db.getMember(iv.organizer_slack_id);
  let organizerId = iv.organizer_slack_id;
  let eventId = iv.event_id;

  if (newIds.includes(organizerId) && oldOrganizer?.refresh_token && eventId) {
    await google.updateEvent(oldOrganizer, eventId, updated, emails);
  } else {
    // Organizer left the interview (or lost access): move the event to a new organizer.
    const oldEventId = eventId;
    organizerId = newIds.find((sid) => db.getMember(sid)?.refresh_token);
    eventId = await google.createEvent(db.getMember(organizerId), updated, emails);
    if (oldEventId && oldOrganizer?.refresh_token) {
      try {
        await google.deleteEvent(oldOrganizer, oldEventId);
      } catch (e) {
        console.error(`[gcal] could not delete old event for interview ${id}: ${e.message}`);
      }
    }
  }

  db.tx(() => {
    db.updateInterview(id, { startUtc: updated.start_utc, endUtc: updated.end_utc, organizer: organizerId, eventId });
    db.setInterviewers(id, newIds);
  });
  invalidate();
  const after = db.getInterview(id);
  events.emit('rescheduled', after, { by, before: iv, conflicts, unconnected });
  return { interview: after, conflicts, unconnected };
}

export const formatTime = (d, fmt = "cccc, LLLL d 'at' h:mm a") => DateTime.fromJSDate(new Date(d), { zone: config.timezone }).toFormat(fmt);
