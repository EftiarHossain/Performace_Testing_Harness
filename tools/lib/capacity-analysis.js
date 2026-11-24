// Assembles the full capacity analysis for one stair-step result.
import { findKnee, fitUsl, sizeCapacity, stepsFromResult } from './capacity.js';

/**
 * @param {object} input
 * @param {any} input.result  Result document of a stair-step (capacity profile) run.
 * @param {{ default: Record<string, number> }} input.slo
 * @param {{ headroom: number, minEfficiency: number, sizing: { growthFactor: number, redundantInstances: number, instancesTested: number } }} input.config
 * @param {number} input.peakDemand  Forecast peak demand, transactions/s.
 */
export function analyseCapacity({ result, slo, config, peakDemand }) {
  if (result.verdict === 'invalid' || result.verdict === 'error') {
    throw new Error(
      `Run ${result.run.id} has verdict "${result.verdict}": its numbers cannot be used for capacity analysis`,
    );
  }
  const criteria = {
    p95: slo.default.p95,
    p99: slo.default.p99,
    errorRate: slo.default.errorRate ?? 0.01,
    minEfficiency: config.minEfficiency,
  };
  const steps = stepsFromResult(result, criteria);
  const knee = findKnee(steps);
  const saturation = steps.reduce(
    (best, step) => (best === null || step.throughput > best.throughput ? step : best),
    /** @type {import('./capacity.js').Step | null} */ (null),
  );
  const usl = fitUsl(
    steps
      .filter((step) => step.concurrency !== null)
      .map((step) => ({
        concurrency: /** @type {number} */ (step.concurrency),
        throughput: step.throughput,
      })),
  );
  const inputs = {
    headroom: config.headroom,
    peakDemand,
    growthFactor: config.sizing.growthFactor,
    redundantInstances: config.sizing.redundantInstances,
    instancesTested: config.sizing.instancesTested,
  };
  // Sizing needs a measured limit; without a knee there is nothing to size against.
  const sizing =
    knee.status === 'found' && knee.knee
      ? sizeCapacity({ kneeThroughput: knee.knee.throughput, ...inputs })
      : null;

  /** @type {string[]} */
  const validityNotes = [];
  if (result.aborted) {
    validityNotes.push(
      'The run was stopped early by an abort threshold; load levels that did not complete are excluded.',
    );
  }
  if (steps.length < 4)
    validityNotes.push(
      `Only ${steps.length} load level(s) completed; the curve is too sparse to trust.`,
    );

  return { run: result.run, criteria, steps, knee, saturation, usl, sizing, inputs, validityNotes };
}
