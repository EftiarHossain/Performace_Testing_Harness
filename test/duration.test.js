import assert from 'node:assert/strict';
import { test } from 'node:test';
import { durationToSeconds } from '../src/lib/duration.js';

test('converts single and compound k6 durations', () => {
  assert.equal(durationToSeconds('30s'), 30);
  assert.equal(durationToSeconds('1m30s'), 90);
  assert.equal(durationToSeconds('2h'), 7200);
  assert.equal(durationToSeconds('500ms'), 0.5);
});

test('rejects malformed durations instead of guessing', () => {
  for (const bad of ['', '30', 'ten seconds', '30s extra', '5d']) {
    assert.throws(() => durationToSeconds(bad), /Invalid duration/);
  }
});
