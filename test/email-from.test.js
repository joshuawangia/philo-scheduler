import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.GMAIL_ADDRESS = 'philo@gmail.com';
delete process.env.EMAIL_FROM;
const { config } = await import('../src/config.js');

test('EMAIL_FROM defaults to the Gmail address when GMAIL_ADDRESS is set', () => {
  assert.equal(config.email.from, 'Philo Interviews <philo@gmail.com>');
});
