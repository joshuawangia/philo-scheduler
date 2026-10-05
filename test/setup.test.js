import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { checkConfig, blockers, warnings, resolveSecret } = await import('../src/config.js');
const { setupPage } = await import('../src/views.js');
const { transportOptions } = await import('../src/mailer.js');

const REQUIRED = ['BASE_URL', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const good = {
  BASE_URL: 'https://philo.example.org',
  SLACK_BOT_TOKEN: 'xoxb-123-abc',
  SLACK_SIGNING_SECRET: 'sig-SUPERSECRETVALUE',
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-TOPSECRETVALUE',
  GMAIL_ADDRESS: 'philo@gmail.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
};
const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));
const bad = (env) => blockers(checkConfig(env)).map((c) => c.name);

test('checkConfig: empty env marks every required setting ❌ and warns about email', () => {
  const checks = checkConfig({});
  assert.deepEqual(bad({}).sort(), [...REQUIRED].sort());
  for (const c of checks) assert.ok(c.hint, `${c.name} has a hint`);
  assert.ok(warnings(checks).some((w) => /emails will not be sent/.test(w)));
  assert.equal(byName(checks).SESSION_SECRET.ok, true); // optional now
});

test('checkConfig: good env is all ✅ with no warnings', () => {
  const checks = checkConfig(good);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
  assert.deepEqual(warnings(checks), []);
});

test('checkConfig: signing secret not needed in Socket Mode', () => {
  const { SLACK_SIGNING_SECRET, ...env } = good;
  assert.deepEqual(bad(env), ['SLACK_SIGNING_SECRET']);
  assert.deepEqual(bad({ ...env, SLACK_APP_TOKEN: 'xapp-1' }), []);
});

test('checkConfig: bad formats are caught', () => {
  assert.deepEqual(bad({ ...good, SLACK_BOT_TOKEN: 'xoxp-user-token' }), ['SLACK_BOT_TOKEN']);
  assert.deepEqual(bad({ ...good, GOOGLE_CLIENT_ID: '123-abc' }), ['GOOGLE_CLIENT_ID']);
  assert.deepEqual(bad({ ...good, BASE_URL: 'https://philo.example.org/' }), ['BASE_URL']);
  assert.deepEqual(bad({ ...good, BASE_URL: 'http://philo.example.org' }), ['BASE_URL']);
  assert.deepEqual(bad({ ...good, BASE_URL: 'philo.example.org' }), ['BASE_URL']);
  assert.deepEqual(bad({ ...good, BASE_URL: 'http://localhost:3000' }), []);
  assert.deepEqual(bad({ ...good, SESSION_SECRET: 'short' }), ['SESSION_SECRET']);
  // email problems are warnings, never blockers
  const smtp = checkConfig({ ...good, SMTP_URL: 'https://mail.example.org' });
  assert.deepEqual(blockers(smtp), []);
  assert.ok(warnings(smtp).some((w) => /SMTP_URL must start with smtp:\/\/ or smtps:\/\//.test(w)));
  assert.ok(warnings(checkConfig({ ...good, GMAIL_ADDRESS: 'not-an-email' })).some((w) => /GMAIL_ADDRESS is not an email/.test(w)));
  assert.ok(warnings(checkConfig({ ...good, GMAIL_APP_PASSWORD: 'hunter2' })).some((w) => /GMAIL_APP_PASSWORD should be 16 letters/.test(w)));
  // a valid SMTP_URL makes the Gmail vars unnecessary
  const { GMAIL_ADDRESS, GMAIL_APP_PASSWORD, ...noGmail } = good;
  assert.deepEqual(warnings(checkConfig({ ...noGmail, SMTP_URL: 'smtps://u:p@smtp.example.org:465' })), []);
});

test('checkConfig: localhost BASE_URL in production is a warning, not a blocker', () => {
  const checks = checkConfig({ ...good, BASE_URL: 'http://localhost:3000', NODE_ENV: 'production' });
  assert.deepEqual(blockers(checks), []);
  assert.ok(warnings(checks).some((w) => /BASE_URL is still http:\/\/localhost/.test(w)));
});

test('session secret file is created once (0600) and reused; env wins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'philo-secret-'));
  const dbPath = path.join(dir, 'nested', 'philo.db');
  const a = resolveSecret({}, dbPath);
  const file = path.join(dir, 'nested', 'session-secret');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(resolveSecret({}, dbPath), a);
  const env = { SESSION_SECRET: 'y'.repeat(40) };
  assert.equal(resolveSecret(env, dbPath), env.SESSION_SECRET);
  assert.throws(() => resolveSecret({ SESSION_SECRET: 'short' }, dbPath), /32 characters/);
  assert.match(resolveSecret({}, ':memory:'), /^[0-9a-f]{64}$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

const manifest = '# Create the app at https://api.slack.com/apps\n# Replace https://philo-interviews.example.com with your BASE_URL.\nslash_commands:\n  url: https://philo-interviews.example.com/slack/events\nrequest_url: https://philo-interviews.example.com/slack/events\n';

test('setup page lists names but never secret values', () => {
  const env = { ...good, SLACK_BOT_TOKEN: 'xoxp-LEAKME-123', SESSION_SECRET: 'S3CRET'.repeat(8) };
  const html = setupPage({ checks: checkConfig(env), address: env.BASE_URL, manifest });
  assert.match(html, /Setup checklist/);
  for (const name of [...REQUIRED, 'GMAIL_ADDRESS', 'GMAIL_APP_PASSWORD']) assert.match(html, new RegExp(name));
  assert.match(html, /❌/);
  for (const v of ['LEAKME', 'S3CRET', 'SUPERSECRETVALUE', 'TOPSECRETVALUE', 'abcd efgh', 'philo@gmail.com']) assert.doesNotMatch(html, new RegExp(v));
});

test('setup page has copy-paste text with the address substituted', () => {
  const html = setupPage({ checks: checkConfig(good), address: 'https://philo.example.org', manifest });
  assert.match(html, /https:\/\/philo\.example\.org\/oauth\/google\/callback/);
  assert.match(html, /url: https:\/\/philo\.example\.org\/slack\/events/);
  assert.doesNotMatch(html, /philo-interviews\.example\.com|# Replace|# Create/);
  assert.match(html, /Google → Authorized redirect URI/);
  assert.match(html, /Slack → Create app → From a manifest \(YAML\)/);
  assert.match(html, /Applicant link/);
  assert.doesNotMatch(html, /❌/);
});

test('setup page uses the derived address when BASE_URL is unset', () => {
  const { BASE_URL, ...env } = good;
  const html = setupPage({ checks: checkConfig(env), address: 'https://philo.up.railway.app', baseUrlSet: false, manifest });
  assert.match(html, /Copy this exact address into Railway as BASE_URL: https:\/\/philo\.up\.railway\.app/);
  assert.match(html, /https:\/\/philo\.up\.railway\.app\/oauth\/google\/callback/);
  assert.doesNotMatch(html, /example\.com/);
});

test('setup page escapes the address', () => {
  const html = setupPage({ checks: [], address: 'https://x"><script>', manifest: '' });
  assert.doesNotMatch(html, /x"><script>/);
});

test('mailer: Gmail vars strip whitespace; SMTP_URL wins; nothing set => null', () => {
  const gmail = transportOptions({ gmailAddress: 'philo@gmail.com', gmailAppPassword: ' abcd efgh\tijkl mnop ' });
  assert.deepEqual(gmail, { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'philo@gmail.com', pass: 'abcdefghijklmnop' } });
  assert.equal(transportOptions({ smtpUrl: 'smtps://u:p@h:465', gmailAddress: 'philo@gmail.com', gmailAppPassword: 'abcdefghijklmnop' }), 'smtps://u:p@h:465');
  assert.equal(transportOptions({ gmailAddress: 'philo@gmail.com' }), null);
  assert.equal(transportOptions({}), null);
});
