import { DateTime } from 'luxon';
import { config } from './config.js';
import * as db from './db.js';
import * as scheduler from './scheduler.js';
import { sendMail } from './mailer.js';

// Records every booking/cancellation/reschedule and emails them to the First Censor:
// once a day at DIGEST_HOUR, or immediately when a change is close to the interview.

// digest.js is loaded on first use; tests swap in a stub builder instead.
let builderOverride = null;
export function setBuilderForTests(fn) {
  builderOverride = fn;
}
async function builder() {
  return builderOverride || (await import('./digest.js')).buildDigest;
}

// True if the interview (or, for a reschedule, its previous time) starts within windowHours
// of now and hasn't ended yet.
export function isUrgent(event, now, windowHours) {
  const t = now.getTime();
  const windowMs = windowHours * 3600e3;
  const iv = event.interview || {};
  const d = event.detail || {};
  const spans = [[iv.start_utc, iv.end_utc], [d.before_start_utc, d.before_end_utc]];
  return spans.some(([start, end]) => {
    if (!start) return false;
    const s = Date.parse(start);
    const e = end ? Date.parse(end) : s;
    return s - t <= windowMs && e > t;
  });
}

let inFlight = null;

// Send every pending event in one email. Concurrent callers wait for the send already in progress
// (and only go again if it succeeded and something new arrived meanwhile).
export async function flush({ urgent = false, now = new Date() } = {}) {
  while (inFlight) {
    const prev = await inFlight;
    if (!prev.sent || !db.pendingDigestEvents().length) return prev;
  }
  inFlight = send(urgent, now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function send(urgent, now) {
  try {
    const pending = db.pendingDigestEvents();
    if (!pending.length) return { sent: 0 };
    const events = pending.filter((e) => e.interview); // interview rows are never deleted after an event, but be safe
    const build = await builder();
    const mail = build({
      events, upcoming: db.upcomingInterviews(), all: db.allInterviews(), names: db.memberNames(),
      now, tz: config.timezone, baseUrl: config.baseUrl, urgent,
    });
    const result = await sendMail({ to: config.email.digestTo, ...mail });
    if (!result?.messageId) return { skipped: true };
    db.markDigestEventsEmailed(pending.map((e) => e.id), new Date().toISOString());
    return { sent: pending.length };
  } catch (e) {
    console.error('[digest] send failed', e);
    return { skipped: true, error: e.message };
  }
}

// Daily digest: once per local day at/after DIGEST_HOUR. A failed send retries next tick.
export async function runDailyIfDue(now = new Date()) {
  const local = DateTime.fromJSDate(now, { zone: config.timezone });
  if (local.hour < config.email.digestHour) return { due: false };
  const today = local.toISODate();
  if (db.getSetting('last_digest_date') === today) return { due: false };
  const result = await flush({ now });
  if (result.sent === undefined) return { due: true, ...result };
  db.setSetting('last_digest_date', today);
  return { due: true, ...result };
}

export function startDigestRunner({ intervalMs = 60_000, now = () => new Date() } = {}) {
  const record = (kind, iv, detail) => {
    try {
      db.recordDigestEvent({ kind, interviewId: iv.id, detail, occurredAt: now().toISOString() });
      if (isUrgent({ interview: iv, detail }, now(), config.email.urgentWindowHours)) {
        flush({ urgent: true, now: now() }).catch((e) => console.error('[digest] urgent flush failed', e));
      }
    } catch (e) {
      console.error('[digest] could not record event', e);
    }
  };
  const onBooked = (iv) => record('booked', iv, null);
  const onCancelled = (iv, { by } = {}) => record('cancelled', iv, by ? { by } : null);
  const onRescheduled = (iv, { by, before } = {}) => record('rescheduled', iv, {
    by, before_start_utc: before?.start_utc, before_end_utc: before?.end_utc, before_interviewers: before?.interviewers || [],
  });
  scheduler.events.on('booked', onBooked);
  scheduler.events.on('cancelled', onCancelled);
  scheduler.events.on('rescheduled', onRescheduled);

  const timer = setInterval(() => {
    runDailyIfDue(now()).catch((e) => console.error('[digest] daily run failed', e));
  }, intervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
      scheduler.events.off('booked', onBooked);
      scheduler.events.off('cancelled', onCancelled);
      scheduler.events.off('rescheduled', onRescheduled);
    },
  };
}
