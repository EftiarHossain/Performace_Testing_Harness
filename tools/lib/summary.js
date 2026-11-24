// Reads k6's end-of-test summary object into one shape, whichever format k6
// produced. k6 1.x passes handleSummary() the "legacy" object by default; the
// "machine-readable" object (opt-in on 1.x, the default from 2.x) is structured
// differently. Everything downstream uses this module so that the k6 format is
// not a dependency of the analysis tools.

/**
 * @typedef {object} Summary
 * @property {'legacy' | 'machine-readable'} format
 * @property {number} durationSeconds
 * @property {(name: string) => number} counter          Count, 0 if never emitted.
 * @property {(name: string) => { matches: number, total: number }} rate
 * @property {(name: string) => Record<string, number> | undefined} trend  Keys: avg, min, med, max, p90, p95, p99...
 * @property {Array<{ name: string, passes: number, fails: number }>} checks
 */

/**
 * "p(95)" (legacy) and "p95" (machine-readable) both become "p95".
 * @param {Record<string, number>} values
 */
function normaliseTrend(values) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key.replace(/^p\((.+)\)$/, 'p$1')] = value;
  }
  return out;
}

/**
 * @param {any} raw The object k6 passed to handleSummary().
 * @returns {Summary}
 */
export function readSummary(raw) {
  /** @type {Map<string, any>} */
  let metrics;
  /** @type {Summary['format']} */
  let format;
  let durationSeconds;
  let checks;

  if (raw?.metrics && raw?.state) {
    format = 'legacy';
    metrics = new Map(Object.entries(raw.metrics).map(([name, m]) => [name, m.values]));
    durationSeconds = raw.state.testRunDurationMs / 1000;
    checks = raw.root_group?.checks ?? [];
  } else if (Array.isArray(raw?.results?.metrics)) {
    format = 'machine-readable';
    metrics = new Map(raw.results.metrics.map((/** @type {any} */ m) => [m.name, m.values]));
    durationSeconds = raw.config?.duration;
    checks = raw.results.checks?.results ?? [];
  } else {
    throw new Error(
      'Unrecognised k6 summary format: expected the legacy or machine-readable shape',
    );
  }
  if (!Number.isFinite(durationSeconds)) throw new Error('k6 summary has no test duration');

  return {
    format,
    durationSeconds,
    counter: (name) => metrics.get(name)?.count ?? 0,
    rate: (name) => {
      const values = metrics.get(name);
      if (!values) return { matches: 0, total: 0 };
      // Legacy calls the non-zero samples "passes"; for transaction_failed those are the failures.
      if (format === 'legacy')
        return { matches: values.passes, total: values.passes + values.fails };
      return { matches: values.matches, total: values.total };
    },
    trend: (name) => {
      const values = metrics.get(name);
      return values ? normaliseTrend(values) : undefined;
    },
    checks: checks.map((/** @type {any} */ c) => ({
      name: c.name,
      passes: c.passes,
      fails: c.fails,
    })),
  };
}
