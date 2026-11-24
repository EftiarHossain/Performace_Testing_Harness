// Builds the harness's own result document from a k6 summary and the plan that
// produced it. This document, not k6's summary, is what baselines, comparison
// and capacity analysis read; SCHEMA_VERSION changes when its shape does.
import { createHash } from 'node:crypto';
import {
  METRIC_DURATION,
  METRIC_FAILED,
  MAX_DROPPED_FRACTION,
  submetric,
  targetsFor,
} from '../../src/lib/thresholds.js';

export const SCHEMA_VERSION = 1;

/** A steady window that started fewer than this share of its planned iterations was not really tested at that rate. */
const MIN_ACHIEVED_FRACTION = 0.98;

/**
 * k6's reported run duration can land a few milliseconds either side of the plan's
 * length; without slack a run that finished normally could lose its last window.
 * Kept small so that a run aborted shortly before a window's end is not counted as
 * having completed it.
 */
const COMPLETION_TOLERANCE_SECONDS = 0.1;

/** k6 exit code for "thresholds failed", which is also what an abortOnFail stop returns. */
const K6_THRESHOLDS_FAILED = 99;

/**
 * Stable hash of a JSON value, independent of key order and formatting.
 * @param {unknown} value
 */
export function stableHash(value) {
  /** @param {any} v @returns {any} */
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((key) => [key, sort(v[key])]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(sort(value)))
    .digest('hex')
    .slice(0, 16);
}

/**
 * @param {import('./summary.js').Summary} summary
 * @param {Record<string, string>} tags
 * @param {number} seconds Duration the samples were collected over.
 */
function measure(summary, tags, seconds) {
  const { matches: failed, total } = summary.rate(submetric(METRIC_FAILED, tags));
  const succeeded = total - failed;
  const trend = succeeded > 0 ? summary.trend(submetric(METRIC_DURATION, tags)) : undefined;
  /** @type {Record<string, number>} */
  const latencyMs = {};
  for (const [key, value] of Object.entries(trend ?? {})) {
    if (key !== 'count') latencyMs[key] = Math.round(value * 100) / 100;
  }
  return {
    transactions: total,
    failed,
    failedRate: total > 0 ? failed / total : null,
    successPerSecond: seconds > 0 ? Math.round((succeeded / seconds) * 100) / 100 : null,
    // null when nothing succeeded: there is no latency to report, and 0 would read as "instant".
    latencyMs: trend ? latencyMs : null,
  };
}

/**
 * @param {object} input
 * @param {import('./summary.js').Summary} input.summary
 * @param {import('../../src/lib/plan.js').Plan} input.plan
 * @param {import('../../src/lib/plan.js').Profile} input.profile
 * @param {import('../../src/lib/workload.js').Workload} input.workload
 * @param {import('../../src/lib/thresholds.js').Slo} input.slo
 * @param {number} input.k6ExitCode
 * @param {ReturnType<typeof import('./generator.js').assessGenerator>} input.generator
 * @param {Record<string, unknown>} input.run  Provenance: id, timestamps, git commit, versions, parameters.
 */
export function buildResult({ summary, plan, profile, workload, slo, k6ExitCode, generator, run }) {
  // A window only counts if the run lasted until its end; an abort threshold in an
  // exploratory profile cuts the plan short, and later windows hold partial data.
  const windows = plan.windows.map((window) => {
    const complete =
      summary.durationSeconds + COMPLETION_TOLERANCE_SECONDS >=
      window.startSeconds + window.durationSeconds;
    const tags = { scenario: window.scenario };
    return {
      scenario: window.scenario,
      phase: window.phase,
      startSeconds: window.startSeconds,
      durationSeconds: window.durationSeconds,
      startRate: window.startRate,
      targetRate: window.targetRate,
      preAllocatedVUs: window.preAllocatedVUs,
      complete,
      plannedIterations: window.expectedIterations,
      iterations: summary.counter(submetric('iterations', tags)),
      droppedIterations: summary.counter(submetric('dropped_iterations', tags)),
      ...measure(summary, tags, window.durationSeconds),
    };
  });
  const aborted = windows.some((window) => !window.complete);
  // Where an early stop happened, by interpolating along the window that was running.
  // Approximate: abort thresholds are evaluated on whole-run totals after a delay, so
  // the system was already past its limit somewhat before this point.
  const stoppedIn = windows.find((window) => !window.complete);
  const stoppedAt = stoppedIn
    ? (() => {
        const elapsed = Math.min(
          Math.max(summary.durationSeconds - stoppedIn.startSeconds, 0),
          stoppedIn.durationSeconds,
        );
        const progress = elapsed / stoppedIn.durationSeconds;
        return {
          scenario: stoppedIn.scenario,
          seconds: Math.round(summary.durationSeconds * 10) / 10,
          approxRate: Math.round(
            stoppedIn.startRate + (stoppedIn.targetRate - stoppedIn.startRate) * progress,
          ),
        };
      })()
    : null;
  const completeSteady = windows.filter((window) => window.complete && window.phase === 'steady');
  const steadySeconds = completeSteady.reduce((sum, window) => sum + window.durationSeconds, 0);

  /** @type {string[]} */
  const reasons = [...generator.problems];
  const planned = windows
    .filter((w) => w.complete)
    .reduce((sum, w) => sum + w.plannedIterations, 0);
  const dropped = summary.counter('dropped_iterations');
  if (dropped > Math.floor(plan.expectedIterations * MAX_DROPPED_FRACTION)) {
    reasons.push(
      `k6 dropped ${dropped} iterations (more than ${MAX_DROPPED_FRACTION * 100}% of the ` +
        `${plan.expectedIterations} planned): the load generator could not start them, ` +
        'usually because it ran out of pre-allocated VUs',
    );
  }
  for (const window of completeSteady) {
    if (window.iterations < window.plannedIterations * MIN_ACHIEVED_FRACTION) {
      reasons.push(
        `${window.scenario}: only ${window.iterations} of ${window.plannedIterations} planned ` +
          `iterations ran at ${window.targetRate}/s`,
      );
    }
  }
  if (completeSteady.length === 0 && k6ExitCode === 0) {
    reasons.push('no steady-state window completed, so there is nothing to judge');
  }

  /** @type {Record<string, any>} */
  const transactions = {};
  /** @type {string[]} */
  const breaches = [];
  for (const { name } of workload.transactions) {
    const measured = measure(summary, { phase: 'steady', transaction: name }, steadySeconds);
    const targets = targetsFor(slo, name);
    /** @type {string[]} */
    const own = [];
    for (const [key, target] of Object.entries(targets)) {
      const actual = key === 'errorRate' ? measured.failedRate : measured.latencyMs?.[key];
      // A percentile k6 did not report cannot be judged here; k6's own thresholds still gate it.
      if (actual !== null && actual !== undefined && actual >= target) {
        own.push(`${name} ${key} ${Math.round(actual * 1000) / 1000} >= ${target}`);
      }
    }
    breaches.push(...own);
    transactions[name] = { ...measured, slo: { targets, breaches: own } };
  }

  /** @type {'pass' | 'fail' | 'invalid' | 'error'} */
  let verdict;
  if (k6ExitCode !== 0 && k6ExitCode !== K6_THRESHOLDS_FAILED) verdict = 'error';
  else if (reasons.length > 0) verdict = 'invalid';
  else if (!profile.gate)
    verdict = 'pass'; // Exploratory: an abort or SLO breach is a finding, not a failure.
  else verdict = k6ExitCode === 0 && breaches.length === 0 ? 'pass' : 'fail';

  return {
    schemaVersion: SCHEMA_VERSION,
    run: {
      ...run,
      k6ExitCode,
      k6SummaryFormat: summary.format,
      measuredSeconds: summary.durationSeconds,
    },
    verdict,
    gate: profile.gate,
    aborted,
    stoppedAt,
    validity: {
      valid: reasons.length === 0,
      reasons,
      plannedIterations: planned,
      droppedIterations: dropped,
      generator,
    },
    sloBreaches: breaches,
    steadySeconds,
    transactions,
    windows,
    checks: summary.checks,
  };
}

/**
 * Structural check of a result document. Returns a list of problems (empty when valid).
 * @param {any} result
 * @returns {string[]}
 */
export function validateResult(result) {
  /** @type {string[]} */
  const problems = [];
  /** @param {boolean} ok @param {string} message */
  const need = (ok, message) => {
    if (!ok) problems.push(message);
  };
  const isNumber = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
  need(result?.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`);
  need(
    ['pass', 'fail', 'invalid', 'error'].includes(result?.verdict),
    'verdict is not a known value',
  );
  for (const key of [
    'id',
    'startedAt',
    'service',
    'profile',
    'environment',
    'k6Version',
    'workloadHash',
  ]) {
    need(
      typeof result?.run?.[key] === 'string' && result.run[key] !== '',
      `run.${key} is required`,
    );
  }
  need(isNumber(result?.run?.timeScale), 'run.timeScale must be a number');
  need(typeof result?.validity?.valid === 'boolean', 'validity.valid must be a boolean');
  need(Array.isArray(result?.validity?.reasons), 'validity.reasons must be an array');
  need(
    result?.validity?.valid === (result?.validity?.reasons?.length === 0),
    'validity.valid must match reasons',
  );
  need(
    Array.isArray(result?.windows) && result.windows.length > 0,
    'windows must be a non-empty array',
  );
  for (const window of result?.windows ?? []) {
    for (const key of [
      'targetRate',
      'durationSeconds',
      'plannedIterations',
      'iterations',
      'droppedIterations',
      'transactions',
      'failed',
    ]) {
      need(isNumber(window[key]), `window ${window.scenario}: ${key} must be a number`);
    }
    need(['ramp', 'steady'].includes(window.phase), `window ${window.scenario}: unknown phase`);
  }
  const names = Object.keys(result?.transactions ?? {});
  need(names.length > 0, 'transactions must not be empty');
  for (const name of names) {
    const tx = result.transactions[name];
    need(
      isNumber(tx.transactions) && isNumber(tx.failed),
      `transaction ${name}: counts must be numbers`,
    );
    need(
      tx.latencyMs === null || typeof tx.latencyMs === 'object',
      `transaction ${name}: latencyMs`,
    );
    need(typeof tx.slo?.targets === 'object', `transaction ${name}: slo.targets is required`);
  }
  return problems;
}
