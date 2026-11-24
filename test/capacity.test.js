import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyseCapacity } from '../tools/lib/capacity-analysis.js';
import { renderChart, renderMarkdown } from '../tools/lib/capacity-report.js';
import {
  findKnee,
  fitUsl,
  sizeCapacity,
  stepsFromResult,
  uslThroughput,
} from '../tools/lib/capacity.js';

const criteria = { p95: 250, p99: 400, errorRate: 0.01, minEfficiency: 0.95 };
const config = {
  headroom: 0.3,
  minEfficiency: 0.95,
  sizing: { growthFactor: 1.5, redundantInstances: 1, instancesTested: 1 },
};
const slo = { default: { p95: 250, p99: 400, errorRate: 0.01 } };

/**
 * A stair-step result for a system with a hard limit: linear and fast up to
 * `capacity`, then throughput is capped, latency jumps and the excess fails.
 * @param {number} capacity
 * @param {number[]} rates
 * @returns {any}
 */
function hardLimitResult(capacity, rates) {
  return {
    verdict: 'pass',
    aborted: false,
    run: {
      id: 'r',
      service: 'example',
      environment: 'local',
      workloadVersion: '1',
      workloadHash: 'h',
      k6Version: 'v1',
      gitCommit: 'abc',
      timeScale: 1,
    },
    windows: rates.flatMap((rate, i) => {
      const over = rate > capacity;
      return [
        { scenario: `p${i * 2 + 1}_ramp`, phase: 'ramp', complete: true, targetRate: rate },
        {
          scenario: `p${i * 2 + 2}_steady`,
          phase: 'steady',
          complete: true,
          targetRate: rate,
          successPerSecond: over ? capacity : rate,
          failedRate: over ? (rate - capacity) / rate : 0,
          latencyMs: over ? { avg: 340, p95: 365, p99: 380 } : { avg: 40, p95: 80, p99: 95 },
        },
      ];
    }),
  };
}

const rates = [40, 80, 120, 160, 200, 240, 280];

test('knee is the last level within limits before the first that is not', () => {
  const steps = stepsFromResult(hardLimitResult(210, rates), criteria);
  assert.deepEqual(
    steps.map((s) => s.offered),
    rates,
  );
  const knee = findKnee(steps);
  assert.equal(knee.status, 'found');
  assert.equal(knee.knee?.offered, 200);
  assert.equal(knee.firstBeyond?.offered, 240);
  assert.deepEqual(knee.firstBeyond?.problems, [
    'p95 365 ms >= 250 ms',
    'failed 12.50% >= 1%',
    'throughput 210.0/s is below 95% of offered 240/s',
  ]);
});

test('the knee follows the capacity of the system', () => {
  for (const [capacity, expected] of [
    [100, 80],
    [130, 120],
    [170, 160],
    [250, 240],
  ]) {
    const knee = findKnee(
      stepsFromResult(hardLimitResult(/** @type {number} */ (capacity), rates), criteria),
    );
    assert.equal(knee.knee?.offered, expected);
  }
});

test('each limit triggers on its own', () => {
  /** @param {object} window */
  const one = (window) =>
    stepsFromResult(
      {
        windows: [
          {
            scenario: 's',
            phase: 'steady',
            complete: true,
            targetRate: 100,
            successPerSecond: 100,
            failedRate: 0,
            latencyMs: { avg: 40, p95: 80, p99: 90 },
            ...window,
          },
        ],
      },
      criteria,
    )[0]?.problems;
  assert.deepEqual(one({}), []);
  assert.deepEqual(one({ latencyMs: { avg: 40, p95: 250, p99: 300 } }), ['p95 250 ms >= 250 ms']);
  assert.deepEqual(one({ latencyMs: { avg: 40, p95: 200, p99: 400 } }), ['p99 400 ms >= 400 ms']);
  assert.deepEqual(one({ failedRate: 0.02 }), ['failed 2.00% >= 1%']);
  assert.deepEqual(one({ successPerSecond: 94 }), [
    'throughput 94.0/s is below 95% of offered 100/s',
  ]);
});

test('a knee that was not reached, or lies below the range, is reported as such', () => {
  const notReached = findKnee(stepsFromResult(hardLimitResult(1000, rates), criteria));
  assert.equal(notReached.status, 'not-reached');
  assert.equal(notReached.knee?.offered, 280);
  const below = findKnee(stepsFromResult(hardLimitResult(10, rates), criteria));
  assert.equal(below.status, 'below-range');
  assert.equal(below.knee, null);
  assert.equal(findKnee([]).status, 'no-data');
});

test('a healthy-looking level after the first breach does not move the knee', () => {
  const result = hardLimitResult(130, rates);
  // Make 200/s look healthy again after 160/s was already beyond the limit.
  result.windows[9] = {
    ...result.windows[9],
    successPerSecond: 200,
    failedRate: 0,
    latencyMs: { avg: 40, p95: 80, p99: 95 },
  };
  assert.equal(findKnee(stepsFromResult(result, criteria)).knee?.offered, 120);
});

test('incomplete and ramp windows are excluded, and levels are ordered by load', () => {
  const result = hardLimitResult(210, [120, 40, 80]);
  result.windows[5] = { ...result.windows[5], complete: false };
  assert.deepEqual(
    stepsFromResult(result, criteria).map((s) => s.offered),
    [40, 120],
  );
});

test('USL fit recovers known coefficients from synthetic data', () => {
  const truth = { lambda: 12, sigma: 0.05, kappa: 0.0008 };
  const data = [1, 2, 4, 8, 16, 24, 32, 48, 64].map((n) => ({
    concurrency: n,
    throughput: uslThroughput(truth, n),
  }));
  const fit = fitUsl(data);
  assert.ok(fit.ok);
  assert.ok(Math.abs(fit.lambda - truth.lambda) < 1e-6);
  assert.ok(Math.abs(fit.sigma - truth.sigma) < 1e-8);
  assert.ok(Math.abs(fit.kappa - truth.kappa) < 1e-9);
  assert.ok(fit.rSquared > 0.999999);
  assert.ok(fit.maxRelativeError < 1e-6);
  // Peak at N* = sqrt((1 - sigma) / kappa) = sqrt(0.95 / 0.0008) = 34.46
  assert.ok(Math.abs((fit.peakConcurrency ?? 0) - Math.sqrt(0.95 / 0.0008)) < 1e-4);
  assert.ok(
    Math.abs((fit.peakThroughput ?? 0) - uslThroughput(truth, Math.sqrt(0.95 / 0.0008))) < 1e-4,
  );
});

test('USL fit tolerates measurement noise', () => {
  const truth = { lambda: 50, sigma: 0.03, kappa: 0.0002 };
  // Deterministic +/-2% noise.
  const data = [1, 3, 6, 10, 15, 22, 30, 40, 55, 70].map((n, i) => ({
    concurrency: n,
    throughput: uslThroughput(truth, n) * (1 + (i % 2 === 0 ? 0.02 : -0.02)),
  }));
  const fit = fitUsl(data);
  assert.ok(fit.ok);
  assert.ok(Math.abs(fit.sigma - truth.sigma) < 0.01, `sigma ${fit.sigma}`);
  assert.ok(Math.abs(fit.kappa - truth.kappa) < 0.0001, `kappa ${fit.kappa}`);
  assert.ok(fit.rSquared > 0.98);
});

test('USL fit of contention-only and linear systems keeps coefficients non-negative', () => {
  const contention = fitUsl(
    [1, 2, 4, 8, 16, 32].map((n) => ({
      concurrency: n,
      throughput: uslThroughput({ lambda: 10, sigma: 0.1, kappa: 0 }, n),
    })),
  );
  assert.ok(contention.ok);
  assert.ok(Math.abs(contention.sigma - 0.1) < 1e-6 && contention.kappa < 1e-9);
  // Asymptote lambda / sigma = 100 when there is no coherency term.
  assert.ok(Math.abs((contention.peakThroughput ?? 0) - 100) < 0.5);

  const linear = fitUsl(
    [1, 2, 4, 8, 16].map((n) => ({
      concurrency: n,
      throughput: 10 * n * (n % 4 === 0 ? 1.01 : 0.99),
    })),
  );
  assert.ok(linear.ok);
  assert.ok(linear.sigma >= 0 && linear.kappa >= 0);
});

test('USL fit refuses too few points', () => {
  const fit = fitUsl([
    { concurrency: 1, throughput: 10 },
    { concurrency: 2, throughput: 19 },
  ]);
  assert.equal(fit.ok, false);
  assert.match(/** @type {{ reason: string }} */ (fit).reason, /at least 4 load levels/);
});

test('headroom and sizing arithmetic', () => {
  const sizing = sizeCapacity({
    kneeThroughput: 200,
    headroom: 0.3,
    peakDemand: 100,
    growthFactor: 1.5,
    redundantInstances: 1,
    instancesTested: 1,
  });
  assert.equal(sizing.safeCapacity, 140);
  assert.equal(sizing.utilisationAtPeak, 0.5);
  assert.equal(sizing.peakWithinSafeCapacity, true);
  assert.equal(sizing.futureDemand, 150);
  // 150 / 140 per instance -> 2 for load, +1 redundancy.
  assert.equal(sizing.instancesForLoad, 2);
  assert.equal(sizing.instancesRecommended, 3);

  // Tested against 4 instances: 35/s safe per instance, 600/s demand -> 18 (ceil 17.14) + 2.
  const fleet = sizeCapacity({
    kneeThroughput: 200,
    headroom: 0.3,
    peakDemand: 400,
    growthFactor: 1.5,
    redundantInstances: 2,
    instancesTested: 4,
  });
  assert.equal(fleet.safePerInstance, 35);
  assert.equal(fleet.instancesForLoad, 18);
  assert.equal(fleet.instancesRecommended, 20);
  assert.equal(fleet.peakWithinSafeCapacity, false);

  // Demand exactly equal to safe capacity needs one instance, not two.
  assert.equal(
    sizeCapacity({
      kneeThroughput: 200,
      headroom: 0.25,
      peakDemand: 150,
      growthFactor: 1,
      redundantInstances: 0,
      instancesTested: 1,
    }).instancesForLoad,
    1,
  );
  assert.throws(
    () =>
      sizeCapacity({
        kneeThroughput: 200,
        headroom: 1,
        peakDemand: 1,
        growthFactor: 1,
        redundantInstances: 0,
        instancesTested: 1,
      }),
    /headroom/,
  );
  assert.throws(
    () =>
      sizeCapacity({
        kneeThroughput: 0,
        headroom: 0.3,
        peakDemand: 1,
        growthFactor: 1,
        redundantInstances: 0,
        instancesTested: 1,
      }),
    /kneeThroughput/,
  );
});

test('full analysis and report for a hard-limit system', () => {
  const analysis = analyseCapacity({
    result: hardLimitResult(210, rates),
    slo,
    config,
    peakDemand: 100,
  });
  assert.equal(analysis.knee.knee?.throughput, 200);
  assert.equal(analysis.saturation?.throughput, 210);
  assert.equal(analysis.sizing?.safeCapacity, 140);
  assert.equal(analysis.sizing?.instancesRecommended, 3);

  const report = renderMarkdown(analysis, { chartFile: 'capacity.svg' });
  assert.match(report, /\*\*Knee: 200\.0 transactions\/s\.\*\*/);
  assert.match(report, /Safe operating capacity: 140\.0 transactions\/s/);
  assert.match(report, /This is a limit, not an operating target/);
  assert.match(report, /!\[Throughput and p95 latency against offered load\]\(capacity\.svg\)/);
  assert.match(report, /\| 240 \| 210\.0 \| 12\.50 \|/);
  assert.match(report, /## Assumptions and limits of this analysis/);
  // A hard limit is not what USL models; the report must say so rather than present the fit as sound.
  assert.ok(analysis.usl.ok && analysis.usl.maxRelativeError > 0.1);
  assert.match(report, /The model does not describe this system well/);

  const svg = renderChart(analysis);
  assert.ok(svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>'));
  assert.equal((svg.match(/<circle/g) ?? []).length, rates.length * 2);
  assert.match(svg, /knee 200\/s/);
  assert.match(svg, /SLO p95 250 ms/);
  assert.ok(!svg.includes('NaN'));
});

test('report states plainly when the knee was not reached, and gives no sizing', () => {
  const analysis = analyseCapacity({
    result: hardLimitResult(1000, rates),
    slo,
    config,
    peakDemand: 100,
  });
  assert.equal(analysis.sizing, null);
  const report = renderMarkdown(analysis, { chartFile: 'capacity.svg' });
  assert.match(report, /The knee was not reached/);
  assert.match(report, /No safe operating capacity or sizing is stated/);
  assert.ok(!renderChart(analysis).includes('knee '));
});

test('development runs and invalid runs are flagged or refused', () => {
  const scaled = hardLimitResult(210, rates);
  scaled.run.timeScale = 0.05;
  assert.match(
    renderMarkdown(analyseCapacity({ result: scaled, slo, config, peakDemand: 100 }), {
      chartFile: 'c.svg',
    }),
    /Development run/,
  );
  const invalid = { ...hardLimitResult(210, rates), verdict: 'invalid' };
  assert.throws(
    () => analyseCapacity({ result: invalid, slo, config, peakDemand: 100 }),
    /cannot be used for capacity analysis/,
  );
});
