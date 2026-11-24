import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildPlan } from '../src/lib/plan.js';
import { assessGenerator } from '../tools/lib/generator.js';
import { renderReport } from '../tools/lib/report.js';
import { buildResult, stableHash, validateResult } from '../tools/lib/result.js';
import { readSummary } from '../tools/lib/summary.js';

const profiles = JSON.parse(readFileSync('config/profiles.json', 'utf8'));
const workload = JSON.parse(readFileSync('config/services/example/workload.json', 'utf8'));
const slo = JSON.parse(readFileSync('config/services/example/slo.json', 'utf8'));
const healthy = assessGenerator([{ cpuPercent: 30, rssBytes: 2e8 }], {
  cores: 8,
  totalMemoryBytes: 16e9,
});
const run = {
  id: 'r1',
  startedAt: '2026-01-01T00:00:00Z',
  service: 'example',
  profile: 'average-load',
  environment: 'local',
  k6Version: 'v1.6.1',
  workloadHash: stableHash(workload),
  timeScale: 0.01,
};

/**
 * A legacy-format k6 summary for the scaled average-load plan (3 s ramp, 18 s steady at 100/s, 1 s ramp).
 * @param {{ p95?: number, failed?: number, steadyIterations?: number, dropped?: number, seconds?: number }} [o]
 */
function legacySummary(o = {}) {
  const { p95 = 80, failed = 0, steadyIterations = 1800, dropped = 0, seconds = 22.4 } = o;
  const trend = {
    avg: 40,
    min: 10,
    med: 38,
    max: 120,
    'p(90)': 70,
    'p(95)': p95,
    'p(99)': 100,
    count: 1,
  };
  /** @param {number} total @param {number} bad */
  const rate = (total, bad) => ({ values: { passes: bad, fails: total - bad, rate: bad / total } });
  /** @type {Record<string, any>} */
  const metrics = {
    dropped_iterations: { values: { count: dropped, rate: 0 } },
    'iterations{scenario:p02_steady}': { values: { count: steadyIterations } },
    'dropped_iterations{scenario:p02_steady}': { values: { count: dropped } },
    'transaction_failed{scenario:p02_steady}': rate(steadyIterations, failed),
    'transaction_duration{scenario:p02_steady}': { values: trend },
  };
  for (const [name, share] of [
    ['list_items', 0.5],
    ['read_item', 0.35],
    ['create_item', 0.1],
    ['login', 0.05],
  ]) {
    const total = Math.round(steadyIterations * /** @type {number} */ (share));
    metrics[`transaction_failed{phase:steady,transaction:${name}}`] = rate(
      total,
      name === 'list_items' ? failed : 0,
    );
    metrics[`transaction_duration{phase:steady,transaction:${name}}`] = { values: trend };
  }
  return {
    state: { testRunDurationMs: seconds * 1000 },
    metrics,
    root_group: {
      checks: [{ name: 'GET /items returns 200', passes: 900 - failed, fails: failed }],
    },
  };
}

/** @param {any} raw @param {{ exit?: number, profile?: string, generator?: any }} [o] */
function resultFor(raw, o = {}) {
  const profile = profiles[o.profile ?? 'average-load'];
  return buildResult({
    summary: readSummary(raw),
    plan: buildPlan(profile, workload, { timeScale: 0.01 }),
    profile,
    workload,
    slo,
    k6ExitCode: o.exit ?? 0,
    generator: o.generator ?? healthy,
    run,
  });
}

test('a clean run passes, is schema-valid and reports steady-state numbers', () => {
  const result = resultFor(legacySummary());
  assert.deepEqual(validateResult(result), []);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.validity.valid, true);
  assert.equal(result.steadySeconds, 18);
  assert.equal(result.transactions.list_items.transactions, 900);
  assert.equal(result.transactions.list_items.successPerSecond, 50);
  assert.deepEqual(result.transactions.list_items.latencyMs, {
    avg: 40,
    min: 10,
    med: 38,
    max: 120,
    p90: 70,
    p95: 80,
    p99: 100,
  });
  const steady = result.windows.find((w) => w.scenario === 'p02_steady');
  assert.equal(steady?.successPerSecond, 100);
  assert.match(renderReport(result), /VERDICT: PASS - all SLOs met/);
});

test('an SLO breach fails a gating profile and names the transaction', () => {
  const result = resultFor(legacySummary({ p95: 320 }), { exit: 99 });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.sloBreaches.includes('list_items p95 320 >= 250'));
  assert.ok(result.sloBreaches.includes('create_item p95 320 >= 300'));
});

test('error-rate breach is detected from failure counts', () => {
  const result = resultFor(legacySummary({ failed: 45 }), { exit: 99 });
  assert.equal(result.verdict, 'fail');
  assert.deepEqual(result.sloBreaches, ['list_items errorRate 0.05 >= 0.01']);
});

test('dropped iterations make the run invalid, which outranks pass and fail', () => {
  const result = resultFor(legacySummary({ dropped: 900, steadyIterations: 900 }), { exit: 99 });
  assert.equal(result.verdict, 'invalid');
  assert.equal(result.validity.reasons.length, 2);
  assert.match(result.validity.reasons[0] ?? '', /dropped 900 iterations/);
  assert.match(result.validity.reasons[1] ?? '', /only 900 of 1800 planned/);
  assert.match(renderReport(result), /INVALID: k6 dropped/);
});

test('a saturated load generator makes the run invalid', () => {
  const samples = Array.from({ length: 5 }, () => ({ cpuPercent: 700, rssBytes: 1e9 }));
  const generator = assessGenerator(samples, { cores: 8, totalMemoryBytes: 16e9 });
  assert.equal(generator.problems.length, 1);
  assert.equal(resultFor(legacySummary(), { generator }).verdict, 'invalid');
  // Two samples above the limit is a spike, not saturation.
  const spike = assessGenerator(samples.slice(0, 2), { cores: 8, totalMemoryBytes: 16e9 });
  assert.deepEqual(spike.problems, []);
  const memory = assessGenerator([{ cpuPercent: 10, rssBytes: 15e9 }], {
    cores: 8,
    totalMemoryBytes: 16e9,
  });
  assert.match(memory.problems[0] ?? '', /memory/);
});

test('a run that ends a few milliseconds short of the plan keeps its last window', () => {
  // The scaled plan is 22 s long; k6 may report 21.98 s for a run that finished normally.
  const result = resultFor(legacySummary({ seconds: 21.98 }));
  assert.equal(result.aborted, false);
  assert.ok(result.windows.every((w) => w.complete));
  // Well short of the plan is a real early stop.
  assert.equal(resultFor(legacySummary({ seconds: 20 })).aborted, true);
});

test('a k6 error exit code is reported as an error, not a failure', () => {
  assert.equal(resultFor(legacySummary(), { exit: 107 }).verdict, 'error');
});

test('an exploratory profile that aborts early is valid up to the abort', () => {
  // Spike plan at time-scale 0.01 has five windows (1, 1, 1, 1 and 3 s); the run stopped during the third.
  const raw = legacySummary({ seconds: 2.5, failed: 500 });
  raw.metrics['iterations{scenario:p01_steady}'] = { values: { count: 50 } };
  raw.metrics['transaction_failed{scenario:p01_steady}'] = {
    values: { passes: 0, fails: 50, rate: 0 },
  };
  const result = resultFor(raw, { exit: 99, profile: 'spike' });
  assert.equal(result.aborted, true);
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(
    result.windows.map((w) => w.complete),
    [true, true, false, false, false],
  );
  assert.match(renderReport(result), /stopped early by an abort threshold/);
  // Stopped 0.5 s into the third window, a 1 s hold at 300/s.
  assert.deepEqual(result.stoppedAt, { scenario: 'p03_steady', seconds: 2.5, approxRate: 300 });
  assert.match(renderReport(result), /had reached about 300\/s when it stopped/);
});

test('a breakpoint ramp that aborts reports the load it had reached', () => {
  // Breakpoint at time-scale 0.01 is one 12 s ramp from 0 to 500/s; stopped at 6 s.
  const result = resultFor(legacySummary({ seconds: 6 }), { exit: 99, profile: 'breakpoint' });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.aborted, true);
  assert.deepEqual(result.stoppedAt, { scenario: 'p01_ramp', seconds: 6, approxRate: 250 });
  assert.equal(resultFor(legacySummary()).stoppedAt, null);
});

test('transactions with no successes report null latency, not zero', () => {
  const raw = legacySummary();
  raw.metrics['transaction_failed{phase:steady,transaction:login}'] = {
    values: { passes: 90, fails: 0, rate: 1 },
  };
  const result = resultFor(raw, { exit: 99 });
  assert.equal(result.transactions.login.latencyMs, null);
  assert.equal(result.transactions.login.failedRate, 1);
});

test('the machine-readable k6 summary format is read to the same shape', () => {
  const summary = readSummary({
    version: '1.0.0',
    config: { duration: 7.2 },
    results: {
      checks: { results: [{ name: 'c', passes: 3, fails: 1 }] },
      metrics: [
        { name: 'iterations{scenario:s}', type: 'counter', values: { count: 13 } },
        {
          name: 'transaction_failed{scenario:s}',
          type: 'rate',
          values: { matches: 2, rate: 0.15, total: 13 },
        },
        {
          name: 'transaction_duration{scenario:s}',
          type: 'trend',
          values: { avg: 46, med: 45, p95: 83 },
        },
      ],
    },
  });
  assert.equal(summary.format, 'machine-readable');
  assert.equal(summary.durationSeconds, 7.2);
  assert.equal(summary.counter('iterations{scenario:s}'), 13);
  assert.equal(summary.counter('never_emitted'), 0);
  assert.deepEqual(summary.rate('transaction_failed{scenario:s}'), { matches: 2, total: 13 });
  assert.deepEqual(summary.trend('transaction_duration{scenario:s}'), {
    avg: 46,
    med: 45,
    p95: 83,
  });
  assert.deepEqual(summary.checks, [{ name: 'c', passes: 3, fails: 1 }]);
  assert.throws(() => readSummary({ something: 'else' }), /Unrecognised k6 summary format/);
});

test('stableHash ignores key order and detects changes', () => {
  assert.equal(
    stableHash({ a: 1, b: [1, { c: 2, d: 3 }] }),
    stableHash({ b: [1, { d: 3, c: 2 }], a: 1 }),
  );
  assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
});

test('validateResult reports structural problems', () => {
  const result = resultFor(legacySummary());
  const broken = { ...result, verdict: 'maybe', run: { ...result.run, workloadHash: '' } };
  assert.deepEqual(validateResult(broken), [
    'verdict is not a known value',
    'run.workloadHash is required',
  ]);
});
