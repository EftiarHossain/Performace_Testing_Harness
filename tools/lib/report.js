// Console report printed after a run, replacing k6's own summary.

/** @param {number | null | undefined} value @param {number} [digits] */
const fmt = (value, digits = 0) =>
  value === null || value === undefined ? '-' : value.toFixed(digits);

/**
 * @param {string[][]} rows First row is the header.
 */
export function table(rows) {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0),
        )
        .join('  '),
    )
    .join('\n');
}

/** @param {any} result A result document (see tools/lib/result.js). */
export function renderReport(result) {
  const lines = [];
  const { run } = result;
  lines.push(
    `Run ${run.id}: ${run.service} / ${run.profile} / ${run.environment}` +
      (run.timeScale < 1 ? `  [time-scale ${run.timeScale}: development run]` : ''),
    '',
    'Steady-state results per transaction',
    table([
      ['transaction', 'count', 'ok/s', 'failed %', 'p50 ms', 'p95 ms', 'p99 ms', 'SLO'],
      ...Object.entries(result.transactions).map(([name, tx]) => [
        name,
        String(tx.transactions),
        fmt(tx.successPerSecond, 1),
        fmt(tx.failedRate === null ? null : tx.failedRate * 100, 2),
        fmt(tx.latencyMs?.med),
        fmt(tx.latencyMs?.p95),
        fmt(tx.latencyMs?.p99),
        tx.slo.breaches.length === 0 ? 'ok' : 'BREACH',
      ]),
    ]),
    '',
    'Load windows',
    table([
      ['window', 'target/s', 'planned', 'ran', 'dropped', 'ok/s', 'failed %', 'p95 ms'],
      ...result.windows.map((/** @type {any} */ w) => [
        w.scenario + (w.complete ? '' : ' (incomplete)'),
        String(w.targetRate),
        fmt(w.plannedIterations),
        String(w.iterations),
        String(w.droppedIterations),
        fmt(w.successPerSecond, 1),
        fmt(w.failedRate === null ? null : w.failedRate * 100, 2),
        fmt(w.latencyMs?.p95),
      ]),
    ]),
    '',
  );
  const generator = result.validity.generator;
  lines.push(
    `Load generator: CPU avg ${fmt(generator.cpuPercentAvg, 1)}% max ${fmt(generator.cpuPercentMax, 1)}% ` +
      `(100% = one core, ${generator.cores} cores), memory max ${fmt(generator.rssMbMax, 0)} MB`,
  );
  if (result.aborted)
    lines.push('Run stopped early by an abort threshold; incomplete windows are excluded.');
  for (const breach of result.sloBreaches) lines.push(`SLO breach: ${breach}`);
  for (const reason of result.validity.reasons) lines.push(`INVALID: ${reason}`);
  const failedChecks = result.checks.filter((/** @type {any} */ c) => c.fails > 0);
  for (const check of failedChecks) lines.push(`Check failed ${check.fails}x: ${check.name}`);
  const meaning = {
    pass: result.gate
      ? 'all SLOs met'
      : 'run completed (exploratory profile: SLOs recorded, not gated)',
    fail: 'SLO thresholds breached',
    invalid: 'the run cannot be trusted; fix the cause and rerun',
    error: `k6 exited with code ${run.k6ExitCode}`,
  };
  lines.push(
    '',
    `VERDICT: ${result.verdict.toUpperCase()} - ${meaning[/** @type {keyof typeof meaning} */ (result.verdict)]}`,
  );
  return lines.join('\n');
}
