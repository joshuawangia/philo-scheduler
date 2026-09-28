import express from 'express';
import bolt from '@slack/bolt';
import { config, validateConfig } from './config.js';
import { openDb } from './db.js';
import { mountWeb, setOnConnected } from './web.js';
import { registerSlack, publishHome } from './slack.js';

const { App, ExpressReceiver, LogLevel } = bolt;

validateConfig();
openDb();

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
mountWeb(web);
setOnConnected((slackId) => publishHome(app.client, slackId).catch(() => {}));

if (config.slack.appToken) {
  await app.start();
  web.listen(config.port);
} else {
  await app.start(config.port);
}
console.log(`philo-scheduler listening on ${config.baseUrl} (port ${config.port}, ${config.slack.appToken ? 'socket' : 'http'} mode)`);
