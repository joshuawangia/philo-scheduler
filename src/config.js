import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// All configuration comes from environment variables (see .env.example).
const gmailAddress = process.env.GMAIL_ADDRESS;

export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  timezone: process.env.TIMEZONE || 'America/New_York',
  dbPath: process.env.DB_PATH || 'data/philo.db',
  secret: process.env.SESSION_SECRET || '', // unset => setupSecret() fills it from a file next to the DB

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN, // set => Socket Mode (handy for local dev)
    firstCensor: process.env.FIRST_CENSOR_SLACK_ID, // optional; otherwise someone runs /philo claim
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },

  email: {
    smtpUrl: process.env.SMTP_URL, // e.g. smtps://user%40gmail.com:app-password@smtp.gmail.com:465; wins over the Gmail vars
    gmailAddress, // simpler: GMAIL_ADDRESS + GMAIL_APP_PASSWORD => Gmail SMTP; neither => log only
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
    from: process.env.EMAIL_FROM || (gmailAddress ? `Philo Interviews <${gmailAddress}>` : 'Philo Interviews <no-reply@philomathean.org>'),
    digestTo: process.env.DIGEST_TO || 'firstcensor@philomathean.org',
    digestHour: Number(process.env.DIGEST_HOUR ?? 8), // local hour the daily digest goes out
    urgentWindowHours: Number(process.env.URGENT_WINDOW_HOURS ?? 24), // changes this close to an interview email immediately
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);

// Pure check of every setting a newcomer has to provide. Never includes values, only names.
// Returns [{ name, ok, required, hint, warn? }]; !ok && required blocks startup, warn is logged/shown.
// slackRejected: Slack answered invalid_auth (or similar) for a well-formed bot token.
export function checkConfig(env = process.env, { slackRejected = false } = {}) {
  const has = (k) => !!(env[k] && String(env[k]).trim());
  const out = [];
  const add = (name, ok, required, hint, warn) => out.push({ name, ok: !!ok, required, hint, ...(warn ? { warn } : {}) });

  const base = env.BASE_URL || '';
  const baseOk = has('BASE_URL') && (base.startsWith('https://') || isLocal(base)) && !base.endsWith('/');
  add('BASE_URL', baseOk, true,
    'The public web address of this app, starting with https:// and with no slash at the end (e.g. https://philo.up.railway.app)',
    baseOk && isLocal(base) && env.NODE_ENV === 'production' ? 'BASE_URL is still http://localhost, so links in Slack and emails will not work for anyone else' : undefined);

  if (slackRejected) add('SLACK_BOT_TOKEN', false, true, 'Slack rejected this token. Copy it again from Slack → your app → Install App (it starts with xoxb-)');
  else add('SLACK_BOT_TOKEN', has('SLACK_BOT_TOKEN') && env.SLACK_BOT_TOKEN.startsWith('xoxb-'), true,
    'Slack → your app → Install App → Bot User OAuth Token (starts with xoxb-)');
  if (has('SLACK_APP_TOKEN')) add('SLACK_SIGNING_SECRET', true, false, 'Not needed: SLACK_APP_TOKEN is set, so Slack connects by Socket Mode');
  else add('SLACK_SIGNING_SECRET', has('SLACK_SIGNING_SECRET'), true, "Slack → your app → Basic Information → App Credentials → Signing Secret. If Slack's Request URL won't verify, this is usually wrong");

  add('GOOGLE_CLIENT_ID', has('GOOGLE_CLIENT_ID') && env.GOOGLE_CLIENT_ID.trim().endsWith('.apps.googleusercontent.com'), true,
    'Google Cloud → Google Auth Platform → Clients → your client → Client ID (ends with .apps.googleusercontent.com)');
  add('GOOGLE_CLIENT_SECRET', has('GOOGLE_CLIENT_SECRET'), true,
    'Google Cloud → Google Auth Platform → Clients → your client → Client secret (usually starts with GOCSPX-)');

  add('SESSION_SECRET', !has('SESSION_SECRET') || env.SESSION_SECRET.length >= 32, true,
    'Optional: leave it blank and one is made for you. If you set it, use at least 32 random characters');

  // Email is never blocking: without it the app works but sends nothing.
  const smtpOk = has('SMTP_URL') && /^smtps?:\/\//.test(env.SMTP_URL);
  if (has('SMTP_URL')) add('SMTP_URL', smtpOk, false, 'Advanced: an smtp:// or smtps:// address for your mail server (most people use the Gmail settings instead)',
    smtpOk ? undefined : 'SMTP_URL must start with smtp:// or smtps://, so emails will not be sent');
  const addrOk = has('GMAIL_ADDRESS') && EMAIL_RE.test(env.GMAIL_ADDRESS.trim());
  const passOk = has('GMAIL_APP_PASSWORD') && /^[a-z]{16}$/i.test(env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''));
  const gmailWarn = (set, ok, what) => (smtpOk ? undefined : set && !ok ? what : !set ? 'not set, so emails will not be sent' : undefined);
  add('GMAIL_ADDRESS', smtpOk || addrOk, false, 'The society Gmail account that sends the digest emails',
    gmailWarn(has('GMAIL_ADDRESS'), addrOk, 'GMAIL_ADDRESS is not an email address, so emails will not be sent'));
  add('GMAIL_APP_PASSWORD', smtpOk || passOk, false, 'Google Account → Security → 2-Step Verification on → App passwords → create one (16 letters)',
    gmailWarn(has('GMAIL_APP_PASSWORD'), passOk, 'GMAIL_APP_PASSWORD should be 16 letters (spaces are fine), so emails will probably not be sent'));
  return out;
}

// Slack errors meaning the bot token itself is bad (vs. Slack being unreachable).
const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked']);
export const isAuthError = (err) => !!err && [err.data?.error, err.original?.data?.error, err.code].some((c) => AUTH_ERRORS.has(c));

export const blockers = (checks) => checks.filter((c) => c.required && !c.ok);
export const warnings = (checks) => checks.filter((c) => c.warn).map((c) => (c.warn.startsWith(c.name) ? c.warn : `${c.name}: ${c.warn}`));

// SESSION_SECRET wins; otherwise a random one is kept in `session-secret` next to the database.
export function resolveSecret(env = process.env, dbPath = config.dbPath) {
  if (env.SESSION_SECRET) {
    if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return env.SESSION_SECRET;
  }
  if (dbPath === ':memory:') return crypto.randomBytes(32).toString('hex');
  const file = path.join(path.dirname(dbPath), 'session-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s + '\n', { mode: 0o600 });
  return s;
}

// Must run before anything signs or encrypts (crypto.js reads config.secret at call time).
export function setupSecret() {
  config.secret = resolveSecret();
}
