// Regression detection: compares a run's steady-state numbers per transaction
// with a stored baseline. Pure logic; the CLI is tools/compare.js.

/**
 * @typedef {object} Tolerances
 * @property {{ percentiles: string[], relative: number, absoluteMs: number }} latency
 *   A percentile regresses only if it is worse by more than `relative` AND by more
 *   than `absoluteMs`: the relative rule alone would flag a 4 ms to 5 ms change.
 * @property {{ absolute: number }} errorRate   Allowed increase in failed share (0 to 1).
 * @property {{ relative: number }} throughput  Allowed drop in total successful transactions per second.
 */

/** Row label for figures that cover every transaction together. */
export const ALL = '(all transactions)';

/**
 * Why two results cannot be compared, or an empty list if they can. Comparing
 * runs of different workloads, profiles or environments yields differences that
 * say nothing about the system, so they are refused rather than reported.
 * @param {any} baseline
 * @param {any} current
 * @returns {string[]}
 */
export function comparabilityProblems(baseline, current) {
  /** @type {string[]} */
  const problems = [];
  for (const [label, result] of [
    ['baseline', baseline],
    ['current run', current],
  ]) {
    if (result.verdict === 'invalid' || result.verdict === 'error') {
      problems.push(`${label} has verdict "${result.verdict}" and cannot be used for comparison`);
    }
  }
  /** @type {Array<[string, string]>} */
  const mustMatch = [
    ['service', 'service'],
    ['profile', 'profile'],
    ['environment', 'environment'],
    ['workloadHash', 'workload model'],
    ['profileHash', 'profile definition'],
    ['timeScale', 'time scale'],
  ];
  for (const [key, label] of mustMatch) {
    if (baseline.run[key] !== current.run[key]) {
      problems.push(
        `${label} differs (baseline ${baseline.run[key]}, current ${current.run[key]})`,
      );
    }
  }
  if (baseline.schemaVersion !== current.schemaVersion) {
    problems.push(
      `result schema differs (baseline v${baseline.schemaVersion}, current v${current.schemaVersion})`,
    );
  }
  return problems;
}

/**
 * @param {number} baseline
 * @param {number} current
 */
function relativeChange(baseline, current) {
  return baseline === 0 ? (current === 0 ? 0 : Infinity) : (current - baseline) / baseline;
}

/**
 * @param {any} baseline Result document used as the reference.
 * @param {any} current  Result document under test.
 * @param {Tolerances} tolerances
 */
export function compareResults(baseline, current, tolerances) {
  /** @type {Array<{ transaction: string, metric: string, unit: string, baseline: number | null, current: number | null, change: number | null, status: 'ok' | 'regressed' | 'improved' | 'skipped' }>} */
  const rows = [];

  for (const [transaction, base] of Object.entries(baseline.transactions)) {
    const now = current.transactions[transaction];

    for (const percentile of tolerances.latency.percentiles) {
      const before = base.latencyMs?.[percentile] ?? null;
      const after = now.latencyMs?.[percentile] ?? null;
      const row = { transaction, metric: percentile, unit: 'ms', baseline: before, current: after };
      if (before === null || after === null) {
        // Missing on one side (k6 did not report it, or nothing succeeded): not judged here.
        rows.push({ ...row, change: null, status: 'skipped' });
        continue;
      }
      const change = relativeChange(before, after);
      const beyondNoise = Math.abs(after - before) > tolerances.latency.absoluteMs;
      const status =
        beyondNoise && change > tolerances.latency.relative
          ? 'regressed'
          : beyondNoise && change < -tolerances.latency.relative
            ? 'improved'
            : 'ok';
      rows.push({ ...row, change, status });
    }

    {
      const before = base.failedRate ?? 0;
      const after = now.failedRate ?? 0;
      const delta = after - before;
      const status =
        delta > tolerances.errorRate.absolute
          ? 'regressed'
          : delta < -tolerances.errorRate.absolute
            ? 'improved'
            : 'ok';
      rows.push({
        transaction,
        metric: 'failed',
        unit: 'share',
        baseline: before,
        current: after,
        change: delta,
        status,
      });
    }
  }

  // Throughput is judged on the total, not per transaction: each iteration picks
  // its transaction at random, so one transaction's share of a run varies by
  // several percent between identical runs, while the total is set by the
  // arrival rate and only falls when the system fails or cannot keep up.
  {
    /** @param {any} result */
    const total = (result) =>
      Object.values(result.transactions).reduce((sum, tx) => sum + (tx.successPerSecond ?? 0), 0);
    const before = total(baseline);
    const after = total(current);
    const change = relativeChange(before, after);
    const status =
      change < -tolerances.throughput.relative
        ? 'regressed'
        : change > tolerances.throughput.relative
          ? 'improved'
          : 'ok';
    rows.push({
      transaction: ALL,
      metric: 'ok/s',
      unit: '/s',
      baseline: before,
      current: after,
      change,
      status,
    });
  }

  const regressed = [
    ...new Set(rows.filter((row) => row.status === 'regressed').map((row) => row.transaction)),
  ];
  return { regressed, rows };
}

/**
 * @param {ReturnType<typeof compareResults>} comparison
 * @param {{ baselineId: string, currentId: string }} ids
 */
export function renderComparison(comparison, ids) {
  /** @param {number | null} value @param {string} unit */
  const value = (value, unit) =>
    value === null
      ? '-'
      : unit === 'share'
        ? `${(value * 100).toFixed(2)}%`
        : value.toFixed(unit === 'ms' ? 0 : 1);
  const lines = [`Baseline ${ids.baselineId}`, `Current  ${ids.currentId}`, ''];
  const header = ['transaction', 'metric', 'baseline', 'current', 'change', ''];
  const body = comparison.rows.map((row) => [
    row.transaction,
    row.metric,
    value(row.baseline, row.unit),
    value(row.current, row.unit),
    row.change === null
      ? '-'
      : row.unit === 'share'
        ? `${row.change >= 0 ? '+' : ''}${(row.change * 100).toFixed(2)} pt`
        : `${row.change >= 0 ? '+' : ''}${(row.change * 100).toFixed(1)}%`,
    row.status === 'ok' ? '' : row.status.toUpperCase(),
  ]);
  const widths = header.map((_, i) =>
    Math.max(...[header, ...body].map((r) => (r[i] ?? '').length)),
  );
  for (const row of [header, ...body]) {
    lines.push(
      row
        .map((cell, i) => (i < 2 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
        .join('  ')
        .trimEnd(),
    );
  }
  lines.push(
    '',
    comparison.regressed.length === 0
      ? 'NO REGRESSION: every transaction is within tolerance of the baseline'
      : `REGRESSION in: ${comparison.regressed.join(', ')}`,
  );
  return lines.join('\n');
}
