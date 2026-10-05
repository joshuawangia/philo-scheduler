import express from 'express';
import bolt from '@slack/bolt';
import { config, checkConfig, blockers, warnings, setupSecret, isAuthError } from './config.js';
import { openDb } from './db.js';
import { mountWeb, setOnConnected, createSetupApp, setupHandler } from './web.js';
import { registerSlack, publishHome } from './slack.js';
import { startDigestRunner } from './digest-runner.js';

const { App, ExpressReceiver, LogLevel } = bolt;

// Not configured yet: don't start Slack, just show the checklist on every page.
function serveSetup(checkOpts = {}) {
  const missing = blockers(checkConfig(process.env, checkOpts));
  console.error(`[setup] missing or invalid settings: ${missing.map((c) => c.name).join(', ')}. Open this app in a browser to see the setup checklist.`);
  createSetupApp({ checkOpts }).listen(config.port, () => console.log(`philo-scheduler setup checklist on port ${config.port}`));
}

// A well-formed but wrong bot token would otherwise crash Bolt at startup (invalid_auth).
async function slackRejectsToken() {
  if (process.env.NODE_ENV === 'test') return false; // matches tokenVerificationEnabled below
  // Plain fetch, not WebClient: keeps this check independent of Bolt's HTTP stack.
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST', headers: { Authorization: `Bearer ${config.slack.botToken}` }, signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data.ok || !isAuthError({ data })) return false;
    console.error(`[setup] Slack rejected SLACK_BOT_TOKEN (${data.error})`);
    return true;
  } catch (e) {
    console.warn(`[setup] could not check SLACK_BOT_TOKEN with Slack: ${e.message}`);
    return false;
  }
}

const checks = checkConfig(process.env);
for (const w of warnings(checks)) console.warn(`[setup] warning: ${w}`);

if (blockers(checks).length) serveSetup();
else if (await slackRejectsToken()) serveSetup({ slackRejected: true });
else {
  setupSecret();
  openDb();
  startDigestRunner();

  const web = express();
  web.set('trust proxy', 1);

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
  web.get('/setup', setupHandler());
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
