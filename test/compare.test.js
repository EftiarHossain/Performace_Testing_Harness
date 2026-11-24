import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ALL,
  comparabilityProblems,
  compareResults,
  renderComparison,
} from '../tools/lib/compare.js';

const tolerances = JSON.parse(readFileSync('config/compare.json', 'utf8'));

/** @param {Record<string, any>} [overrides] per-transaction overrides */
function result(overrides = {}) {
  /** @param {string} name @param {number} med @param {number} rate */
  const tx = (name, med, rate) => ({
    transactions: rate * 60,
    failed: 0,
    failedRate: 0,
    successPerSecond: rate,
    latencyMs: { med, p95: med * 2, p99: med * 2.5 },
    ...(overrides[name] ?? {}),
  });
  return {
    schemaVersion: 1,
    verdict: 'pass',
    run: {
      id: 'r',
      service: 's',
      profile: 'average-load',
      environment: 'local',
      workloadHash: 'w',
      profileHash: 'p',
      timeScale: 1,
    },
    transactions: { list_items: tx('list_items', 40, 50), read_item: tx('read_item', 20, 35) },
  };
}

test('a run compared with itself has no regression', () => {
  const comparison = compareResults(result(), result(), tolerances);
  assert.deepEqual(comparison.regressed, []);
  assert.ok(comparison.rows.every((row) => row.status === 'ok'));
  assert.match(renderComparison(comparison, { baselineId: 'a', currentId: 'b' }), /NO REGRESSION/);
});

test('slower latency beyond both tolerances is a regression naming the transaction', () => {
  const slow = result({ list_items: { latencyMs: { med: 60, p95: 120, p99: 150 } } });
  const comparison = compareResults(result(), slow, tolerances);
  assert.deepEqual(comparison.regressed, ['list_items']);
  const p95 = comparison.rows.find(
    (row) => row.transaction === 'list_items' && row.metric === 'p95',
  );
  assert.equal(p95?.status, 'regressed');
  assert.equal(p95?.change, 0.5);
  assert.match(
    renderComparison(comparison, { baselineId: 'a', currentId: 'b' }),
    /REGRESSION in: list_items/,
  );
});

test('a large relative change that is tiny in absolute terms is noise, not a regression', () => {
  // 20 ms -> 24 ms is +20% but only 4 ms, below the 5 ms floor.
  const noisy = result({ read_item: { latencyMs: { med: 24, p95: 44, p99: 54 } } });
  assert.deepEqual(compareResults(result(), noisy, tolerances).regressed, []);
});

test('a large absolute change within the relative tolerance is not a regression', () => {
  const base = result({ list_items: { latencyMs: { med: 400, p95: 800, p99: 1000 } } });
  const now = result({ list_items: { latencyMs: { med: 430, p95: 860, p99: 1080 } } });
  assert.deepEqual(compareResults(base, now, tolerances).regressed, []);
});

test('error-rate increase and throughput drop are regressions', () => {
  const errors = result({ read_item: { failedRate: 0.02 } });
  assert.deepEqual(compareResults(result(), errors, tolerances).regressed, ['read_item']);
  // Total falls from 85/s to 75/s (-11.8%), beyond the 5% tolerance.
  const slowerThroughput = result({ list_items: { successPerSecond: 40 } });
  assert.deepEqual(compareResults(result(), slowerThroughput, tolerances).regressed, [ALL]);
});

test('a shift in mix between transactions at the same total throughput is not a regression', () => {
  // Random transaction selection moves a few percent of traffic between transactions run to run.
  const shifted = result({
    list_items: { successPerSecond: 46 },
    read_item: { successPerSecond: 39 },
  });
  const comparison = compareResults(result(), shifted, tolerances);
  assert.deepEqual(comparison.regressed, []);
  assert.deepEqual(
    comparison.rows
      .filter((row) => row.metric === 'ok/s')
      .map((row) => [row.transaction, row.baseline, row.current]),
    [[ALL, 85, 85]],
  );
});

test('improvements are reported but do not fail', () => {
  const faster = result({ list_items: { latencyMs: { med: 20, p95: 40, p99: 50 } } });
  const comparison = compareResults(result(), faster, tolerances);
  assert.deepEqual(comparison.regressed, []);
  assert.ok(comparison.rows.some((row) => row.status === 'improved'));
});

test('a percentile missing on one side is skipped', () => {
  const partial = result({ list_items: { latencyMs: { med: 40, p95: 80 } } });
  const comparison = compareResults(result(), partial, tolerances);
  const p99 = comparison.rows.find(
    (row) => row.transaction === 'list_items' && row.metric === 'p99',
  );
  assert.equal(p99?.status, 'skipped');
  assert.deepEqual(comparison.regressed, []);
});

test('runs that differ in workload, profile, environment or scale are refused', () => {
  assert.deepEqual(comparabilityProblems(result(), result()), []);
  /** @type {Array<[string, unknown, RegExp]>} */
  const cases = [
    ['workloadHash', 'other', /workload model differs/],
    ['profile', 'stress', /profile differs/],
    ['profileHash', 'x', /profile definition differs/],
    ['environment', 'staging', /environment differs/],
    ['timeScale', 0.1, /time scale differs/],
  ];
  for (const [key, value, expected] of cases) {
    const other = result();
    /** @type {Record<string, unknown>} */ (other.run)[key] = value;
    assert.match(comparabilityProblems(result(), other).join('\n'), expected);
  }
  const invalid = { ...result(), verdict: 'invalid' };
  assert.match(
    comparabilityProblems(result(), invalid)[0] ?? '',
    /current run has verdict "invalid"/,
  );
});
