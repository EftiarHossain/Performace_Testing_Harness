// Pure module (no k6 imports): compiles SLOs and run-validity rules into k6
// thresholds, and names the tagged submetrics the results pipeline reads back.

export const METRIC_DURATION = 'transaction_duration';
export const METRIC_FAILED = 'transaction_failed';

/** Share of planned iterations k6 may fail to start before the run is not trustworthy. */
export const MAX_DROPPED_FRACTION = 0.01;

/**
 * @typedef {Record<string, number>} SloTargets  e.g. { p95: 250, p99: 400, errorRate: 0.01 }
 * @typedef {{ default: SloTargets, transactions?: Record<string, SloTargets> }} Slo
 */

/**
 * The key k6 uses for a tagged submetric, in both thresholds and the summary.
 * @param {string} metric
 * @param {Record<string, string>} tags
 */
export function submetric(metric, tags) {
  const selector = Object.entries(tags)
    .map(([key, value]) => `${key}:${value}`)
    .join(',');
  return `${metric}{${selector}}`;
}

/**
 * Effective targets for one transaction: its overrides on top of the defaults.
 * @param {Slo} slo
 * @param {string} transaction
 * @returns {SloTargets}
 */
export function targetsFor(slo, transaction) {
  return { ...slo.default, ...(slo.transactions?.[transaction] ?? {}) };
}

/**
 * @param {string} key e.g. "p95", "p99.9"
 * @returns {string | undefined} k6 trend stat, e.g. "p(95)"
 */
function percentileStat(key) {
  const match = /^p(\d+(?:\.\d+)?)$/.exec(key);
  return match ? `p(${match[1]})` : undefined;
}

/**
 * Validate an SLO file and list the percentile stats it uses.
 * @param {Slo} slo
 * @param {string[]} transactions
 * @returns {string[]} trend stats such as ["p(95)", "p(99)"]
 */
export function sloTrendStats(slo, transactions) {
  if (!slo || typeof slo.default !== 'object') throw new Error('SLO file needs a "default" block');
  for (const name of Object.keys(slo.transactions ?? {})) {
    if (!transactions.includes(name)) {
      throw new Error(`SLO defined for unknown transaction "${name}"`);
    }
  }
  const stats = new Set();
  for (const transaction of transactions) {
    for (const [key, value] of Object.entries(targetsFor(slo, transaction))) {
      const stat = percentileStat(key);
      if (!stat && key !== 'errorRate') {
        throw new Error(`Unknown SLO key "${key}": use pNN (milliseconds) or errorRate (0 to 1)`);
      }
      if (!Number.isFinite(value) || value <= 0) throw new Error(`SLO ${key} must be > 0`);
      if (key === 'errorRate' && value >= 1) throw new Error('SLO errorRate must be below 1');
      if (stat) stats.add(stat);
    }
  }
  return [...stats].sort();
}

/**
 * @param {object} input
 * @param {Slo} input.slo
 * @param {string[]} input.transactions
 * @param {import('./plan.js').Plan} input.plan
 * @param {boolean} input.gate  True: SLO breaches fail the run. False: record only.
 * @param {{ failedRate: number, p95Ms: number, delay: string }} [input.abort]
 * @returns {Record<string, Array<string | object>>} k6 `options.thresholds`
 */
export function compileThresholds({ slo, transactions, plan, gate, abort }) {
  /** @type {Record<string, Array<string | object>>} */
  const thresholds = {};
  /** @param {string} key @param {string | object} threshold */
  const add = (key, threshold) => {
    (thresholds[key] ??= []).push(threshold);
  };

  // k6 only reports a tagged submetric in the summary if a threshold names it.
  // Where a metric must be recorded without gating, an always-true threshold
  // is the supported way to surface it.
  const OBSERVE = { trend: 'max>=0', rate: 'rate>=0', counter: 'count>=0' };

  // Per-transaction SLOs, judged on steady state only so ramps do not dilute them.
  for (const transaction of transactions) {
    const tags = { phase: 'steady', transaction };
    const duration = submetric(METRIC_DURATION, tags);
    const failed = submetric(METRIC_FAILED, tags);
    add(duration, OBSERVE.trend);
    add(failed, OBSERVE.rate);
    if (!gate) continue;
    for (const [key, value] of Object.entries(targetsFor(slo, transaction))) {
      const stat = percentileStat(key);
      if (stat) add(duration, `${stat}<${value}`);
      else add(failed, `rate<${value}`);
    }
  }

  // Per-window metrics: what the capacity analysis reads for each load level.
  for (const window of plan.windows) {
    const tags = { scenario: window.scenario };
    add(submetric(METRIC_DURATION, tags), OBSERVE.trend);
    add(submetric(METRIC_FAILED, tags), OBSERVE.rate);
    add(submetric('iterations', tags), OBSERVE.counter);
    add(submetric('dropped_iterations', tags), OBSERVE.counter);
  }

  // Validity: arrival-rate executors silently fall behind when the generator runs
  // out of VUs, so a run that dropped more than a sliver of its planned load fails.
  add('dropped_iterations', `count<=${Math.floor(plan.expectedIterations * MAX_DROPPED_FRACTION)}`);

  // Safety stop for profiles that deliberately push past the limit.
  if (abort) {
    const stop = { abortOnFail: true, delayAbortEval: abort.delay };
    add(METRIC_FAILED, { threshold: `rate<${abort.failedRate}`, ...stop });
    add(METRIC_DURATION, { threshold: `p(95)<${abort.p95Ms}`, ...stop });
  }
  return thresholds;
}
