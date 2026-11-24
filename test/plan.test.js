import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildPlan, expandStages } from '../src/lib/plan.js';
import { compileThresholds, sloTrendStats, submetric, targetsFor } from '../src/lib/thresholds.js';

const profiles = JSON.parse(readFileSync('config/profiles.json', 'utf8'));
const workload = JSON.parse(readFileSync('config/services/example/workload.json', 'utf8'));
const slo = JSON.parse(readFileSync('config/services/example/slo.json', 'utf8'));
const transactions = workload.transactions.map((/** @type {{ name: string }} */ tx) => tx.name);

test('every bundled profile builds a contiguous plan', () => {
  const names = Object.keys(profiles);
  assert.deepEqual(names, [
    'smoke',
    'average-load',
    'stress',
    'spike',
    'soak',
    'breakpoint',
    'capacity',
  ]);
  for (const name of names) {
    const plan = buildPlan(profiles[name], workload);
    let clock = 0;
    for (const window of plan.windows) {
      assert.equal(window.startSeconds, clock, `${name}/${window.scenario} start`);
      clock += window.durationSeconds;
    }
    assert.equal(plan.totalSeconds, clock);
    assert.equal(Object.keys(plan.scenarios).length, plan.windows.length);
  }
});

test('average-load: ramp, steady hold at peak rate, ramp down', () => {
  const plan = buildPlan(profiles['average-load'], workload);
  assert.deepEqual(
    plan.windows.map((w) => [w.scenario, w.startRate, w.targetRate, w.durationSeconds]),
    [
      ['p01_ramp', 0, 100, 300],
      ['p02_steady', 100, 100, 1800],
      ['p03_ramp', 100, 0, 120],
    ],
  );
  assert.equal(plan.expectedIterations, 15000 + 180000 + 6000);
  assert.deepEqual(plan.scenarios.p02_steady, {
    executor: 'constant-arrival-rate',
    rate: 100,
    duration: '1800s',
    startTime: '300s',
    timeUnit: '1s',
    preAllocatedVUs: 100,
    gracefulStop: '5s',
    tags: { phase: 'steady' },
  });
  assert.deepEqual(plan.scenarios.p01_ramp, {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    stages: [{ duration: '300s', target: 100 }],
    startTime: '0s',
    timeUnit: '1s',
    preAllocatedVUs: 100,
    gracefulStop: '5s',
    tags: { phase: 'ramp' },
  });
});

test('smoke uses absolute rates, independent of the workload peak', () => {
  const plan = buildPlan(profiles.smoke, { ...workload, peakRate: 5000 });
  assert.equal(plan.windows.length, 1);
  assert.equal(plan.windows[0]?.targetRate, 2);
});

test('capacity steps expand without floating-point drift', () => {
  const stages = expandStages(profiles.capacity);
  const holds = stages.filter((stage) => !stage.ramp).map((stage) => stage.target);
  assert.deepEqual(holds, [0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3]);
  const plan = buildPlan(profiles.capacity, workload);
  const steady = plan.windows.filter((w) => w.phase === 'steady');
  assert.deepEqual(
    steady.map((w) => w.targetRate),
    [40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300],
  );
  assert.equal(steady[0]?.scenario, 'p02_steady');
});

test('timeScale shortens stages and vuOverride forces VU allocation', () => {
  const plan = buildPlan(profiles['average-load'], workload, { timeScale: 0.01, vuOverride: 3 });
  assert.deepEqual(
    plan.windows.map((w) => w.durationSeconds),
    [3, 18, 1],
  );
  assert.ok(plan.windows.every((w) => w.preAllocatedVUs === 3));
  assert.throws(() => buildPlan(profiles.smoke, workload, { timeScale: 2 }), /timeScale/);
});

test('invalid profiles are rejected', () => {
  assert.throws(
    () => buildPlan({ ...profiles.smoke, unit: 'rps' }, workload),
    /Unknown profile unit/,
  );
  assert.throws(
    () => expandStages({ ...profiles.smoke, stages: undefined }),
    /neither stages nor steps/,
  );
  assert.throws(
    () => buildPlan({ ...profiles.smoke, stages: [{ duration: '10s', target: 0.2 }] }, workload),
    /at least 1\/s/,
  );
});

test('SLO targets merge per-transaction overrides over defaults', () => {
  assert.deepEqual(targetsFor(slo, 'list_items'), { p95: 250, p99: 400, errorRate: 0.01 });
  assert.deepEqual(targetsFor(slo, 'create_item'), { p95: 300, p99: 500, errorRate: 0.01 });
  assert.deepEqual(sloTrendStats(slo, transactions), ['p(95)', 'p(99)']);
  assert.throws(() => sloTrendStats({ default: { avg: 100 } }, transactions), /Unknown SLO key/);
  assert.throws(
    () => sloTrendStats({ default: { p95: 1 }, transactions: { nope: { p95: 1 } } }, transactions),
    /unknown transaction "nope"/,
  );
});

test('gating profile compiles SLOs into steady-state thresholds', () => {
  const plan = buildPlan(profiles['average-load'], workload);
  const thresholds = compileThresholds({ slo, transactions, plan, gate: true });
  assert.deepEqual(thresholds['transaction_duration{phase:steady,transaction:create_item}'], [
    'max>=0',
    'p(95)<300',
    'p(99)<500',
  ]);
  assert.deepEqual(thresholds['transaction_failed{phase:steady,transaction:login}'], [
    'rate>=0',
    'rate<0.01',
  ]);
  // 1% of 201,000 planned iterations.
  assert.deepEqual(thresholds.dropped_iterations, ['count<=2010']);
  assert.deepEqual(thresholds['iterations{scenario:p02_steady}'], ['count>=0']);
  assert.equal(thresholds.transaction_failed, undefined);
});

test('exploratory profile records without gating and adds abort thresholds', () => {
  const plan = buildPlan(profiles.capacity, workload);
  const thresholds = compileThresholds({
    slo,
    transactions,
    plan,
    gate: false,
    abort: profiles.capacity.abort,
  });
  assert.deepEqual(thresholds['transaction_duration{phase:steady,transaction:list_items}'], [
    'max>=0',
  ]);
  assert.deepEqual(thresholds.transaction_failed, [
    { threshold: 'rate<0.4', abortOnFail: true, delayAbortEval: '1m' },
  ]);
  assert.deepEqual(thresholds.transaction_duration, [
    { threshold: 'p(95)<10000', abortOnFail: true, delayAbortEval: '1m' },
  ]);
  for (const window of plan.windows) {
    assert.ok(thresholds[submetric('dropped_iterations', { scenario: window.scenario })]);
  }
});
