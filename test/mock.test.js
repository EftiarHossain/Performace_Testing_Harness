import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { theoreticalCapacity, WorkerPool } from '../mock/pool.js';
import { configFromEnv, createMockServer } from '../mock/server.js';

test('theoretical capacity is workers divided by mix-weighted service time', () => {
  const config = { workers: 8, serviceMs: 40 };
  assert.equal(theoreticalCapacity(config, [{ cost: 1, weight: 1 }]), 200);
  // Mean cost (0.5 * 3 + 2.0 * 1) / 4 = 0.875 -> 8 / 0.035 s
  const mixed = theoreticalCapacity(config, [
    { cost: 0.5, weight: 3 },
    { cost: 2.0, weight: 1 },
  ]);
  assert.ok(Math.abs(mixed - 8 / 0.035) < 1e-9);
  assert.throws(() => theoreticalCapacity(config, []), /positive/);
});

test('pool rejects once workers and queue are full, and serves the rest', async () => {
  const pool = new WorkerPool({ workers: 2, queueLimit: 3, serviceMs: 20, jitter: 0 });
  const results = await Promise.all(Array.from({ length: 10 }, () => pool.serve(1)));
  assert.equal(results.filter(Boolean).length, 5);
  assert.deepEqual(pool.snapshot(), { busy: 0, queued: 0, served: 5, rejected: 5, maxQueued: 3 });
});

test('pool throughput matches the designed capacity', async () => {
  // 4 workers at 25 ms -> 160 req/s, so 80 queued requests should take about 0.5 s.
  const pool = new WorkerPool({ workers: 4, queueLimit: 1000, serviceMs: 25, jitter: 0 });
  const started = performance.now();
  await Promise.all(Array.from({ length: 80 }, () => pool.serve(1)));
  const seconds = (performance.now() - started) / 1000;
  const throughput = 80 / seconds;
  assert.ok(throughput > 160 * 0.8 && throughput <= 160 * 1.02, `measured ${throughput} req/s`);
});

test('configFromEnv rejects invalid numbers', () => {
  assert.throws(() => configFromEnv({ MOCK_WORKERS: 'many' }), /MOCK_WORKERS/);
  assert.equal(configFromEnv({ MOCK_WORKERS: '3' }).workers, 3);
});

/** @type {import('node:http').Server} */
let server;
let base = '';
const auth = { authorization: 'Bearer mock-token-alice', 'content-type': 'application/json' };

before(async () => {
  server = createMockServer({ workers: 2, queueLimit: 2, serviceMs: 5, jitter: 0 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});
after(() => server.close());

test('endpoints: login, list, read, write, auth and errors', async () => {
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'x' }),
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).token, 'mock-token-alice');

  const list = await fetch(`${base}/items`, { headers: auth });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items.length, 20);

  assert.equal((await fetch(`${base}/items/7`, { headers: auth })).status, 200);
  assert.equal((await fetch(`${base}/items/99999`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/items`)).status, 401);

  const write = await fetch(`${base}/items`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'new' }),
  });
  assert.equal(write.status, 201);
  assert.equal((await fetch(`${base}/nope`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

test('overload returns 503 with Retry-After while health stays up', async () => {
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => fetch(`${base}/items`, { headers: auth })),
  );
  const rejected = responses.filter((r) => r.status === 503);
  assert.ok(rejected.length > 0, 'expected some 503s');
  assert.equal(rejected[0]?.headers.get('retry-after'), '1');
  assert.ok(responses.some((r) => r.status === 200));
  await Promise.all(responses.map((r) => r.arrayBuffer()));
  const stats = await (await fetch(`${base}/__admin/stats`)).json();
  assert.ok(stats.pool.rejected > 0);
});
