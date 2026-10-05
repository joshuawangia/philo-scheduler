import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
// Secret-looking values in the real environment: the page must never echo them.
const SECRETS = {
  SLACK_BOT_TOKEN: 'xoxb-SECRETVALUE-bot-123',
  SLACK_SIGNING_SECRET: 'SIGNINGSECRETVALUE',
  GOOGLE_CLIENT_ID: 'CLIENTIDVALUE.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-CLIENTSECRETVALUE',
  SESSION_SECRET: 'SESSIONSECRETVALUE'.repeat(3),
  GMAIL_ADDRESS: 'secretsender@gmail.com',
  GMAIL_APP_PASSWORD: 'qwer tyui opas dfgh',
  SMTP_URL: 'smtps://user:SMTPPASSWORDVALUE@smtp.example.org:465',
};
Object.assign(process.env, SECRETS);
delete process.env.BASE_URL;
const { createSetupApp } = await import('../src/web.js');
const { checkConfig, blockers, isAuthError } = await import('../src/config.js');

const servers = [];
after(() => servers.forEach((s) => s.close()));
async function listen(app) {
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return server.address().port;
}
// node:http so we can set Host (fetch forbids it).
const get = (port, path, headers = {}) =>
  new Promise((resolve, reject) => {
    http.get({ port, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (c) => (body += c)).on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });

test('setup app derives https://host from X-Forwarded-Proto when BASE_URL is unset', async () => {
  const port = await listen(createSetupApp());
  const { status, body } = await get(port, '/', { 'X-Forwarded-Proto': 'https', Host: 'philo-test.up.railway.app' });
  assert.equal(status, 200);
  assert.match(body, /Copy this exact address into Railway as BASE_URL: https:\/\/philo-test\.up\.railway\.app/);
  assert.match(body, /https:\/\/philo-test\.up\.railway\.app\/oauth\/google\/callback/);
  assert.match(body, /url: https:\/\/philo-test\.up\.railway\.app\/slack\/events/);
  assert.doesNotMatch(body, /example\.com|# Replace/);
  const plain = await get(port, '/anything', { Host: 'philo-test.up.railway.app' });
  assert.match(plain.body, /BASE_URL: http:\/\/philo-test\.up\.railway\.app/);
  const health = await get(port, '/healthz');
  assert.deepEqual(health, { status: 200, body: 'setup needed' });
});

test('setup page from the real code path never shows values from process.env', async () => {
  const port = await listen(createSetupApp());
  for (const p of ['/', '/setup', '/slack/events']) {
    const { body } = await get(port, p, { Host: 'philo.test' });
    assert.match(body, /Setup checklist/);
    for (const [name, value] of Object.entries(SECRETS)) {
      assert.match(body, new RegExp(name));
      for (const piece of value.split(/[\s:@]+/).filter((x) => x.length > 6 && !/googleusercontent|gmail\.com|smtp\.example/.test(x)))
        assert.ok(!body.includes(piece), `${name} value leaked on ${p}`);
    }
    assert.ok(!body.includes('secretsender@gmail.com'));
  }
});

test('isAuthError recognises Slack token rejections only', () => {
  for (const code of ['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked']) {
    assert.ok(isAuthError({ data: { error: code } }), code);
    assert.ok(isAuthError({ original: { data: { error: code } } }), `wrapped ${code}`);
  }
  assert.ok(!isAuthError({ data: { error: 'ratelimited' } }));
  assert.ok(!isAuthError({ code: 'ECONNREFUSED' }));
  assert.ok(!isAuthError(new Error('network down')));
  assert.ok(!isAuthError(null));
});

test('a rejected token turns SLACK_BOT_TOKEN ❌ with a re-copy hint and is shown on the page', async () => {
  const env = { ...SECRETS, BASE_URL: 'https://philo.example.org' };
  assert.deepEqual(blockers(checkConfig(env)), []);
  const rejected = blockers(checkConfig(env, { slackRejected: true }));
  assert.deepEqual(rejected.map((c) => c.name), ['SLACK_BOT_TOKEN']);
  assert.equal(rejected[0].hint, 'Slack rejected this token. Copy it again from Slack → your app → Install App (it starts with xoxb-)');
  const port = await listen(createSetupApp({ env, checkOpts: { slackRejected: true } }));
  const { body } = await get(port, '/');
  assert.match(body, /❌<\/span> <strong>SLACK_BOT_TOKEN/);
  assert.match(body, /Slack rejected this token/);
  assert.ok(!body.includes('SECRETVALUE'));
});
