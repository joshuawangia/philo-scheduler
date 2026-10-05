import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import * as google from './google.js';
import * as scheduler from './scheduler.js';
import { verify, encrypt } from './crypto.js';
import { checkConfig } from './config.js';
import { slotsPage, interviewPage, messagePage, icsFile, setupPage } from './views.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Called after a philo connects Google so Slack can refresh their App Home.
let onConnected = () => {};
export const setOnConnected = (fn) => (onConnected = fn);

// Tiny in-memory rate limiter: each booking attempt costs Google API calls.
function rateLimit({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(req.ip, list);
    if (hits.size > 10000) hits.clear();
    if (list.length > max) return res.status(429).send(messagePage('Slow down', 'Too many attempts. Please wait a few minutes and try again.'));
    next();
  };
}

// ---- setup checklist: names and ✅/❌ only, plus the exact text to paste into Google and Slack ----
function readManifest() {
  try {
    return fs.readFileSync(path.join(rootDir, 'slack-manifest.yml'), 'utf8');
  } catch {
    return '';
  }
}

// Express handler; checkOpts is passed to checkConfig (e.g. { slackRejected: true }).
export function setupHandler({ env = process.env, checkOpts = {} } = {}) {
  return (req, res) => {
    const baseUrlSet = !!env.BASE_URL?.trim();
    const address = baseUrlSet ? env.BASE_URL.trim().replace(/\/+$/, '') : `${req.protocol}://${req.get('host')}`;
    res.set('Cache-Control', 'no-store').send(setupPage({ checks: checkConfig(env, checkOpts), address, baseUrlSet, manifest: readManifest() }));
  };
}

// Standalone server used until required settings are in place: every page is the checklist.
export function createSetupApp(opts = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/healthz', (_req, res) => res.send('setup needed'));
  app.use(express.static(publicDir, { maxAge: '1h' }));
  app.use(setupHandler(opts));
  return app;
}

export function mountWeb(app) {
  app.use(express.static(publicDir, { maxAge: '1h' }));
  const form = express.urlencoded({ extended: false, limit: '10kb' });

  app.get('/healthz', (_req, res) => res.send('ok'));

  // ---- applicant pages ----
  app.get('/', async (_req, res, next) => {
    try {
      const open = db.getSetting('booking_open') === '1';
      res.send(slotsPage({ slots: open ? await scheduler.openSlots() : [], open }));
    } catch (e) {
      next(e);
    }
  });

  app.post('/book', rateLimit({ max: 8, windowMs: 10 * 60 * 1000 }), form, async (req, res, next) => {
    const values = { name: String(req.body.name || '').trim(), email: String(req.body.email || '').trim(), start: String(req.body.start || '') };
    const rerender = async (error) =>
      res.status(400).send(slotsPage({ slots: await scheduler.openSlots(), open: db.getSetting('booking_open') === '1', error, values }));
    try {
      if (!values.name || !EMAIL_RE.test(values.email) || !values.start) return await rerender('Please enter your name, email, and a time.');
      const iv = await scheduler.book({ startIso: values.start, name: values.name, email: values.email });
      res.redirect(303, `/a/${iv.applicant_token}?new=1`);
    } catch (e) {
      if (e instanceof scheduler.BookingError) return rerender(e.message).catch(next);
      next(e);
    }
  });

  app.get('/a/:token', (req, res) => {
    const iv = db.getInterviewByToken(req.params.token);
    if (!iv) return res.status(404).send(messagePage('Not found', 'We could not find that interview.'));
    res.send(interviewPage({ iv, justBooked: req.query.new === '1', location: db.getSetting('location') }));
  });

  app.get('/a/:token/interview.ics', (req, res) => {
    const iv = db.getInterviewByToken(req.params.token);
    if (!iv || iv.status !== 'booked') return res.status(404).send(messagePage('Not found', 'We could not find that interview.'));
    res.type('text/calendar').attachment('philomathean-interview.ics').send(icsFile(iv, db.getSetting('location')));
  });

  app.post('/a/:token/cancel', rateLimit({ max: 20, windowMs: 10 * 60 * 1000 }), async (req, res, next) => {
    try {
      const iv = db.getInterviewByToken(req.params.token);
      if (!iv) return res.status(404).send(messagePage('Not found', 'We could not find that interview.'));
      if (iv.status === 'booked') await scheduler.cancel(iv.id, { by: 'applicant' });
      res.redirect(303, `/a/${iv.applicant_token}`);
    } catch (e) {
      next(e);
    }
  });

  // ---- Google Calendar connection (link comes from Slack) ----
  app.get('/connect', (req, res) => {
    if (!verify(req.query.s)) return res.status(400).send(messagePage('Link expired', 'Run /philo connect in Slack for a fresh link.'));
    res.redirect(google.authUrl(req.query.s));
  });

  app.get('/oauth/google/callback', async (req, res, next) => {
    try {
      const state = verify(req.query.state);
      if (!state?.slackId) return res.status(400).send(messagePage('Link expired', 'Run /philo connect in Slack for a fresh link.'));
      if (req.query.error || !req.query.code) return res.send(messagePage('Not connected', 'Google Calendar was not connected.'));
      const { refreshToken, email } = await google.exchangeCode(req.query.code);
      if (!refreshToken) return res.status(400).send(messagePage('Try again', 'Google did not return offline access. Run /philo connect again.'));
      db.upsertMember({ slackId: state.slackId, name: state.name, email, refreshToken: encrypt(refreshToken) });
      scheduler.invalidate();
      onConnected(state.slackId);
      res.send(messagePage('Connected', `Your calendar (${email}) is connected. You can close this tab and return to Slack.`));
    } catch (e) {
      next(e);
    }
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).send(messagePage('Something went wrong', 'Please try again in a moment.'));
  });
}
