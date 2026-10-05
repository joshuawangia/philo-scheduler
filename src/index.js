import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bolt from '@slack/bolt';
import { config, checkConfig, blockers, warnings, setupSecret } from './config.js';
import { openDb } from './db.js';
import { mountWeb, setOnConnected } from './web.js';
import { registerSlack, publishHome } from './slack.js';
import { startDigestRunner } from './digest-runner.js';
import { setupPage } from './views.js';

const { App, ExpressReceiver, LogLevel } = bolt;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Setup checklist: names and ✅/❌ only, plus the exact text to paste into Google and Slack.
const manifest = () => {
  try {
    return fs.readFileSync(path.join(root, 'slack-manifest.yml'), 'utf8');
  } catch {
    return '';
  }
};
const sendSetup = (req, res) => {
  const baseUrlSet = !!process.env.BASE_URL;
  const address = baseUrlSet ? process.env.BASE_URL.trim().replace(/\/+$/, '') : `${req.protocol}://${req.get('host')}`;
  res.set('Cache-Control', 'no-store').send(setupPage({ checks: checkConfig(process.env), address, baseUrlSet, manifest: manifest() }));
};

const checks = checkConfig(process.env);
const missing = blockers(checks);
for (const w of warnings(checks)) console.warn(`[setup] warning: ${w}`);

const web = express();
web.set('trust proxy', 1);

if (missing.length) {
  // Not configured yet: don't start Slack, just show the checklist on every page.
  console.error(`[setup] missing or invalid settings: ${missing.map((c) => c.name).join(', ')}. Open this app in a browser to see the setup checklist.`);
  web.get('/healthz', (_req, res) => res.send('setup needed'));
  web.use(express.static(path.join(root, 'public'), { maxAge: '1h' }));
  web.use(sendSetup);
  web.listen(config.port, () => console.log(`philo-scheduler setup checklist on port ${config.port}`));
} else {
  setupSecret();
  openDb();
  startDigestRunner();

  let app;
  if (config.slack.appToken) {
    // Socket Mode: Slack connects out over a websocket, no public Slack URL needed (good for local dev).
    app = new App({ token: config.slack.botToken, appToken: config.slack.appToken, socketMode: true, logLevel: LogLevel.INFO });
  } else {
    // HTTP mode: Slack posts to BASE_URL/slack/events on the same server as the applicant site.
    const receiver = new ExpressReceiver({ signingSecret: config.slack.signingSecret, app: web });
    app = new App({ token: config.slack.botToken, receiver, logLevel: LogLevel.INFO, tokenVerificationEnabled: process.env.NODE_ENV !== 'test' });
  }

  registerSlack(app);
  web.get('/setup', sendSetup);
  mountWeb(web);
  setOnConnected((slackId) => publishHome(app.client, slackId).catch(() => {}));

  if (config.slack.appToken) {
    await app.start();
    web.listen(config.port);
  } else {
    await app.start(config.port);
  }
  console.log(`philo-scheduler listening on ${config.baseUrl} (port ${config.port}, ${config.slack.appToken ? 'socket' : 'http'} mode)`);
}
