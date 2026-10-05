import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db;

export const DEFAULT_SETTINGS = {
  window_start: '', // YYYY-MM-DD, first interview day
  window_end: '', // YYYY-MM-DD, last interview day (inclusive)
  day_start: '09:00', // HH:MM local time; interviews must fit between day_start and day_end
  day_end: '23:00',
  slot_minutes: '120', // interview length
  step_minutes: '60', // how often a new start time is offered
  interviewers_per_slot: '2',
  min_notice_hours: '12',
  location: 'Philomathean Halls, 4th floor of College Hall',
  booking_open: '1',
  first_censor: '',
  last_digest_date: '', // yyyy-MM-dd local, last day the daily digest ran
};

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (
      slack_id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      refresh_token TEXT,
      connected_at TEXT
    );
    CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_utc TEXT NOT NULL,
      end_utc TEXT NOT NULL,
      applicant_name TEXT NOT NULL,
      applicant_email TEXT NOT NULL,
      applicant_token TEXT NOT NULL UNIQUE,
      organizer_slack_id TEXT,
      event_id TEXT,
      status TEXT NOT NULL DEFAULT 'booked',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS interview_interviewers (
      interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      slack_id TEXT NOT NULL,
      PRIMARY KEY (interview_id, slack_id)
    );
    CREATE TABLE IF NOT EXISTS digest_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      interview_id INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      detail TEXT,
      emailed_at TEXT
    );
  `);
  if (config.slack.firstCensor && !getSetting('first_censor')) setSetting('first_censor', config.slack.firstCensor);
  return db;
}

export const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

// ---- settings ----
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
  return out;
}
export const isFirstCensor = (slackId) => !!slackId && getSetting('first_censor') === slackId;

// /philo claim: the first person to claim becomes First Censor; after that only a hand-off changes it.
export function claimFirstCensor(slackId) {
  return tx(() => {
    const current = getSetting('first_censor');
    if (current) return { ok: false, current };
    setSetting('first_censor', slackId);
    return { ok: true, current: slackId };
  });
}

// ---- members (philos) ----
export const getMember = (slackId) => db.prepare('SELECT * FROM members WHERE slack_id = ?').get(slackId);
export const connectedMembers = () => db.prepare('SELECT * FROM members WHERE refresh_token IS NOT NULL ORDER BY name').all();
export function upsertMember({ slackId, name, email, refreshToken }) {
  db.prepare(`
    INSERT INTO members (slack_id, name, email, refresh_token, connected_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(slack_id) DO UPDATE SET
      name = COALESCE(excluded.name, name), email = excluded.email,
      refresh_token = COALESCE(excluded.refresh_token, refresh_token), connected_at = excluded.connected_at
  `).run(slackId, name ?? null, email ?? null, refreshToken ?? null);
}
export const organizedUpcoming = (slackId) =>
  db.prepare("SELECT COUNT(*) n FROM interviews WHERE status = 'booked' AND end_utc > ? AND organizer_slack_id = ?").get(new Date().toISOString(), slackId).n;
export function memberNames() {
  return Object.fromEntries(db.prepare('SELECT slack_id, name FROM members').all().map((r) => [r.slack_id, r.name || r.slack_id]));
}
export const disconnectMember = (slackId) => db.prepare('UPDATE members SET refresh_token = NULL WHERE slack_id = ?').run(slackId);

// ---- interviews ----
function hydrate(row) {
  if (!row) return row;
  row.interviewers = db.prepare('SELECT slack_id FROM interview_interviewers WHERE interview_id = ?').all(row.id).map((r) => r.slack_id);
  return row;
}
export const getInterview = (id) => hydrate(db.prepare('SELECT * FROM interviews WHERE id = ?').get(id));
export const getInterviewByToken = (t) => hydrate(db.prepare('SELECT * FROM interviews WHERE applicant_token = ?').get(t));
export const activeInterviewByEmail = (email) =>
  hydrate(db.prepare("SELECT * FROM interviews WHERE status = 'booked' AND lower(applicant_email) = lower(?) AND end_utc > ?").get(email, new Date().toISOString()));

export function upcomingInterviews({ slackId } = {}) {
  const now = new Date().toISOString();
  const rows = slackId
    ? db.prepare(`SELECT i.* FROM interviews i JOIN interview_interviewers x ON x.interview_id = i.id
                  WHERE i.status = 'booked' AND i.end_utc > ? AND x.slack_id = ? ORDER BY i.start_utc`).all(now, slackId)
    : db.prepare("SELECT * FROM interviews WHERE status = 'booked' AND end_utc > ? ORDER BY start_utc").all(now);
  return rows.map(hydrate);
}

// Booked interviews overlapping [startIso, endIso), with interviewer ids.
export function bookedBetween(startIso, endIso) {
  return db.prepare("SELECT * FROM interviews WHERE status = 'booked' AND start_utc < ? AND end_utc > ?").all(endIso, startIso).map(hydrate);
}

// All interviews, any status (for the CSV export).
export const allInterviews = () => db.prepare('SELECT * FROM interviews ORDER BY start_utc, id').all().map(hydrate);

export function insertInterview(i) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO interviews (start_utc, end_utc, applicant_name, applicant_email, applicant_token, organizer_slack_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(i.startUtc, i.endUtc, i.name, i.email, i.token, i.interviewers[0]);
  setInterviewers(Number(lastInsertRowid), i.interviewers);
  return Number(lastInsertRowid);
}
export function setInterviewers(id, slackIds) {
  db.prepare('DELETE FROM interview_interviewers WHERE interview_id = ?').run(id);
  const ins = db.prepare('INSERT INTO interview_interviewers (interview_id, slack_id) VALUES (?, ?)');
  for (const s of slackIds) ins.run(id, s);
}
export function updateInterview(id, fields) {
  const cols = { startUtc: 'start_utc', endUtc: 'end_utc', organizer: 'organizer_slack_id', eventId: 'event_id', status: 'status' };
  const keys = Object.keys(fields).filter((k) => cols[k]);
  if (!keys.length) return;
  db.prepare(`UPDATE interviews SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}
export const deleteInterview = (id) => db.prepare('DELETE FROM interviews WHERE id = ?').run(id);

// Interview counts per philo (used to spread the load evenly).
export function loadCounts() {
  const rows = db.prepare(`SELECT x.slack_id, COUNT(*) n FROM interview_interviewers x
    JOIN interviews i ON i.id = x.interview_id WHERE i.status = 'booked' GROUP BY x.slack_id`).all();
  return Object.fromEntries(rows.map((r) => [r.slack_id, r.n]));
}

// ---- digest events (booked / cancelled / rescheduled, emailed to the First Censor) ----
export function recordDigestEvent({ kind, interviewId, detail = null, occurredAt = new Date().toISOString() }) {
  const { lastInsertRowid } = db.prepare('INSERT INTO digest_events (kind, interview_id, occurred_at, detail) VALUES (?, ?, ?, ?)')
    .run(kind, interviewId, occurredAt, detail == null ? null : JSON.stringify(detail));
  return Number(lastInsertRowid);
}
export function pendingDigestEvents() {
  return db.prepare('SELECT id, kind, interview_id, occurred_at, detail FROM digest_events WHERE emailed_at IS NULL ORDER BY id').all()
    .map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null, interview: getInterview(e.interview_id) }));
}
export function markDigestEventsEmailed(ids, atIso = new Date().toISOString()) {
  if (!ids.length) return;
  db.prepare(`UPDATE digest_events SET emailed_at = ? WHERE id IN (${ids.map(() => '?').join(', ')})`).run(atIso, ...ids);
}
