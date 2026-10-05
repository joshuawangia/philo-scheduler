import { test } from 'node:test';
import assert from 'node:assert/strict';
delete process.env.FIRST_CENSOR_SLACK_ID;
const db = await import('../src/db.js');
db.openDb(':memory:');

test('claimFirstCensor: first caller wins, later callers are told who it is', () => {
  assert.equal(db.getSetting('first_censor'), '');
  assert.deepEqual(db.claimFirstCensor('U1'), { ok: true, current: 'U1' });
  assert.ok(db.isFirstCensor('U1'));
  assert.deepEqual(db.claimFirstCensor('U2'), { ok: false, current: 'U1' });
  assert.deepEqual(db.claimFirstCensor('U1'), { ok: false, current: 'U1' });
  assert.ok(!db.isFirstCensor('U2'));
});
