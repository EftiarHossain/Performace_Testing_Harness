// Pure module (no k6 imports): turns a declarative profile plus a workload model
// into k6 scenarios. Every stage becomes its own scenario so that steady-state
// windows are measured separately from ramps: k6's end-of-test summary aggregates
// a whole scenario, so a window can only be isolated by giving it a scenario.
import { durationToSeconds } from './duration.js';

/**
 * @typedef {object} Stage
 * @property {string} duration
 * @property {number} target   Rate, in the profile's unit.
 * @property {boolean} [ramp]  True: move linearly to target. False: hold target (steady state).
 *
 * @typedef {object} Profile
 * @property {string} description
 * @property {'absolute' | 'peak-multiplier'} unit
 * @property {boolean} gate    Whether SLO breaches fail the run (false for exploratory profiles).
 * @property {{ failedRate: number, p95Ms: number, delay: string }} [abort]
 * @property {Stage[]} [stages]
 * @property {{ from: number, to: number, increment: number, hold: string, transition: string }} [steps]
 *
 * @typedef {object} Window
 * @property {string} scenario
 * @property {'ramp' | 'steady'} phase
 * @property {number} startSeconds
 * @property {number} durationSeconds
 * @property {number} startRate        Transactions per second at the start of the window.
 * @property {number} targetRate       Transactions per second at the end of the window.
 * @property {number} expectedIterations
 * @property {number} preAllocatedVUs
 *
 * @typedef {object} Plan
 * @property {Record<string, object>} scenarios  k6 `options.scenarios`.
 * @property {Window[]} windows
 * @property {number} totalSeconds
 * @property {number} expectedIterations
 */

/**
 * Expand the `steps` shorthand of a stair-step profile into explicit stages.
 * @param {Profile} profile
 * @returns {Stage[]}
 */
export function expandStages(profile) {
  if (profile.stages && profile.steps) throw new Error('Profile defines both stages and steps');
  if (profile.stages) return profile.stages;
  if (!profile.steps) throw new Error('Profile defines neither stages nor steps');
  const { from, to, increment, hold, transition } = profile.steps;
  if (!(increment > 0) || !(to >= from) || !(from > 0)) {
    throw new Error('steps need from > 0, to >= from and increment > 0');
  }
  /** @type {Stage[]} */
  const stages = [];
  const count = Math.floor((to - from) / increment + 1e-9) + 1;
  for (let i = 0; i < count; i += 1) {
    // Round away accumulated floating-point error (0.4 + 0.2 * 3 = 1.0000000000000002).
    const target = Math.round((from + i * increment) * 1e6) / 1e6;
    stages.push({ duration: transition, target, ramp: true });
    stages.push({ duration: hold, target });
  }
  return stages;
}

/**
 * @param {number} seconds
 * @returns {string} k6 duration; whole seconds so windows line up exactly
 */
function toDuration(seconds) {
  return `${seconds}s`;
}

/**
 * @param {Profile} profile
 * @param {{ peakRate: number, maxIterationSeconds: number, requestTimeout: string }} workload
 * @param {{ timeScale?: number, vuOverride?: number }} [options]
 *   timeScale shortens every stage (for development runs); vuOverride forces the
 *   pre-allocated VU count (used to demonstrate an under-provisioned generator).
 * @returns {Plan}
 */
export function buildPlan(profile, workload, options = {}) {
  const timeScale = options.timeScale ?? 1;
  if (!(timeScale > 0 && timeScale <= 1)) throw new Error('timeScale must be in (0, 1]');
  const unitRate = profile.unit === 'absolute' ? 1 : workload.peakRate;
  if (profile.unit !== 'absolute' && profile.unit !== 'peak-multiplier') {
    throw new Error(`Unknown profile unit "${profile.unit}"`);
  }

  /** @type {Record<string, object>} */
  const scenarios = {};
  /** @type {Window[]} */
  const windows = [];
  let clock = 0;
  let previousRate = 0;

  expandStages(profile).forEach((stage, index) => {
    // k6 arrival rates are integers per time unit.
    const targetRate = Math.round(stage.target * unitRate);
    const phase = stage.ramp ? 'ramp' : 'steady';
    if (phase === 'steady' && targetRate < 1) {
      throw new Error(
        `Stage ${index + 1}: steady rate rounds to ${targetRate}/s; must be at least 1/s`,
      );
    }
    const durationSeconds = Math.max(1, Math.round(durationToSeconds(stage.duration) * timeScale));
    const startRate = phase === 'ramp' ? previousRate : targetRate;
    const scenario = `p${String(index + 1).padStart(2, '0')}_${phase}`;
    const preAllocatedVUs =
      options.vuOverride ??
      Math.max(1, Math.ceil(Math.max(startRate, targetRate) * workload.maxIterationSeconds));
    const common = {
      startTime: toDuration(clock),
      timeUnit: '1s',
      preAllocatedVUs,
      // In-flight requests may run up to the request timeout after the window closes.
      gracefulStop: workload.requestTimeout,
      tags: { phase },
    };
    scenarios[scenario] =
      phase === 'ramp'
        ? {
            executor: 'ramping-arrival-rate',
            startRate,
            stages: [{ duration: toDuration(durationSeconds), target: targetRate }],
            ...common,
          }
        : {
            executor: 'constant-arrival-rate',
            rate: targetRate,
            duration: toDuration(durationSeconds),
            ...common,
          };
    windows.push({
      scenario,
      phase,
      startSeconds: clock,
      durationSeconds,
      startRate,
      targetRate,
      expectedIterations: ((startRate + targetRate) / 2) * durationSeconds,
      preAllocatedVUs,
    });
    clock += durationSeconds;
    previousRate = targetRate;
  });

  return {
    scenarios,
    windows,
    totalSeconds: clock,
    expectedIterations: windows.reduce((sum, window) => sum + window.expectedIterations, 0),
  };
}
