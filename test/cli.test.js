import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCli } from '../tools/run.js';

test('parses a profile with defaults', () => {
  assert.deepEqual(parseCli(['smoke']), {
    help: false,
    profile: 'smoke',
    env: undefined,
    service: 'example',
    timeScale: 1,
    vus: undefined,
    allowProduction: false,
    otel: false,
  });
});

test('parses every option', () => {
  const cli = parseCli([
    'capacity',
    '--env',
    'staging',
    '--service',
    'orders',
    '--time-scale',
    '0.1',
    '--vus',
    '50',
    '--otel',
    '--allow-production',
  ]);
  assert.deepEqual(cli, {
    help: false,
    profile: 'capacity',
    env: 'staging',
    service: 'orders',
    timeScale: 0.1,
    vus: 50,
    allowProduction: true,
    otel: true,
  });
});

test('rejects bad input instead of guessing', () => {
  assert.throws(() => parseCli([]), /Exactly one profile/);
  assert.throws(() => parseCli(['a', 'b']), /Exactly one profile/);
  assert.throws(() => parseCli(['smoke', '--time-scale', '0']), /--time-scale/);
  assert.throws(() => parseCli(['smoke', '--time-scale', '1.5']), /--time-scale/);
  assert.throws(() => parseCli(['smoke', '--vus', '0']), /--vus/);
  assert.throws(() => parseCli(['smoke', '--vus', '2.5']), /--vus/);
  assert.throws(() => parseCli(['smoke', '--unknown']), /Unknown option/);
  assert.deepEqual(parseCli(['--help']), { help: true });
});
