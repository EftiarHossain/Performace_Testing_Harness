import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createMockServer } from '../mock/server.js';
import { assertTargetAllowed } from '../src/lib/guard.js';
import { sampleServerStats } from '../tools/lib/server-stats.js';

/** @type {import('node:http').Server} */
let server;
let base = '';
const dir = mkdtempSync(path.join(os.tmpdir(), 'harness-stats-'));

before(async () => {
  server = createMockServer({ workers: 2, queueLimit: 2, serviceMs: 5, jitter: 0 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});
after(() => server.close());

test('samples a JSON endpoint into timestamped JSON Lines', async () => {
  const file = path.join(dir, 'stats.jsonl');
  const sampler = sampleServerStats(`${base}/__admin/stats`, file, 50);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const summary = await sampler.stop();
  assert.equal(summary.file, 'stats.jsonl');
  assert.equal(summary.errors, 0);
  assert.ok(summary.samples >= 3, `samples: ${summary.samples}`);
  const lines = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, summary.samples);
  assert.equal(lines[0].stats.config.workers, 2);
  assert.ok(!Number.isNaN(Date.parse(lines[0].t)));
});

test('failed polls are counted and never throw', async () => {
  const sampler = sampleServerStats(`${base}/does-not-exist`, path.join(dir, 'missing.jsonl'), 50);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const summary = await sampler.stop();
  assert.equal(summary.samples, 0);
  assert.ok(summary.errors >= 2);
});

test('a stats URL outside the allowlist is refused', () => {
  const environment = {
    name: 'x',
    baseUrl: 'http://127.0.0.1:3333',
    allowedHosts: ['127.0.0.1'],
    production: false,
    serverStatsUrl: 'http://metrics.example.com/stats',
  };
  assert.throws(
    () => assertTargetAllowed(environment),
    /serverStatsUrl host "metrics.example.com" is not in the allowlist/,
  );
  assert.doesNotThrow(() =>
    assertTargetAllowed({ ...environment, serverStatsUrl: 'http://127.0.0.1:9100/metrics.json' }),
  );
});
