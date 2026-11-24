// Capacity analysis of a stair-step run: where the system stops keeping up (the
// knee), its ceiling, a Universal Scalability Law fit, and what that means for
// safe operating load and instance count. Pure logic; the CLI is tools/capacity.js.

/**
 * @typedef {object} Step  One steady-state load level.
 * @property {string} scenario
 * @property {number} offered      Arrival rate requested, transactions/s.
 * @property {number} throughput   Successful transactions/s.
 * @property {number} failedRate   Share of transactions that failed (0 to 1).
 * @property {number | null} avgMs
 * @property {number | null} p95Ms
 * @property {number | null} p99Ms
 * @property {number | null} concurrency  Mean transactions in the system (Little's law).
 * @property {string[]} problems   Why this step is past the knee; empty when healthy.
 *
 * @typedef {object} Criteria
 * @property {number} [p95]        Latency limit in ms (from the SLO).
 * @property {number} [p99]
 * @property {number} errorRate    Failed-share limit (from the SLO).
 * @property {number} minEfficiency  Successful throughput must be at least this share of offered load.
 */

/**
 * Steady, completed windows of a result, in increasing order of offered load.
 * @param {any} result A result document from a stair-step run.
 * @param {Criteria} criteria
 * @returns {Step[]}
 */
export function stepsFromResult(result, criteria) {
  return result.windows
    .filter((/** @type {any} */ w) => w.phase === 'steady' && w.complete)
    .map((/** @type {any} */ w) => {
      const throughput = w.successPerSecond ?? 0;
      const avgMs = w.latencyMs?.avg ?? null;
      const step = {
        scenario: w.scenario,
        offered: w.targetRate,
        throughput,
        failedRate: w.failedRate ?? 0,
        avgMs,
        p95Ms: w.latencyMs?.p95 ?? null,
        p99Ms: w.latencyMs?.p99 ?? null,
        // Little's law: mean number in the system = throughput x mean time in the system.
        concurrency: avgMs === null ? null : (throughput * avgMs) / 1000,
        problems: /** @type {string[]} */ ([]),
      };
      if (criteria.p95 !== undefined && step.p95Ms !== null && step.p95Ms >= criteria.p95) {
        step.problems.push(`p95 ${Math.round(step.p95Ms)} ms >= ${criteria.p95} ms`);
      }
      if (criteria.p99 !== undefined && step.p99Ms !== null && step.p99Ms >= criteria.p99) {
        step.problems.push(`p99 ${Math.round(step.p99Ms)} ms >= ${criteria.p99} ms`);
      }
      if (step.failedRate >= criteria.errorRate) {
        step.problems.push(
          `failed ${(step.failedRate * 100).toFixed(2)}% >= ${criteria.errorRate * 100}%`,
        );
      }
      if (throughput < step.offered * criteria.minEfficiency) {
        step.problems.push(
          `throughput ${throughput.toFixed(1)}/s is below ${criteria.minEfficiency * 100}% of offered ${step.offered}/s`,
        );
      }
      return step;
    })
    .sort((/** @type {Step} */ a, /** @type {Step} */ b) => a.offered - b.offered);
}

/**
 * The knee is the highest load level the system handled within its limits before
 * the first level where it did not. Later levels that happen to look healthy are
 * ignored: once a system has tipped over, recovery at a higher load is not capacity.
 * @param {Step[]} steps
 */
export function findKnee(steps) {
  const firstBad = steps.findIndex((step) => step.problems.length > 0);
  if (steps.length === 0)
    return { status: /** @type {const} */ ('no-data'), knee: null, firstBeyond: null };
  if (firstBad === -1) {
    // Never tipped over: the real knee is somewhere above the highest load tested.
    return {
      status: /** @type {const} */ ('not-reached'),
      knee: steps.at(-1) ?? null,
      firstBeyond: null,
    };
  }
  if (firstBad === 0) {
    return {
      status: /** @type {const} */ ('below-range'),
      knee: null,
      firstBeyond: steps[0] ?? null,
    };
  }
  return {
    status: /** @type {const} */ ('found'),
    knee: steps[firstBad - 1] ?? null,
    firstBeyond: steps[firstBad] ?? null,
  };
}

/**
 * Solve a small linear system by Gaussian elimination with partial pivoting.
 * @param {number[][]} matrix Square matrix (modified in place).
 * @param {number[]} rhs
 * @returns {number[] | null} null when the system is singular.
 */
function solve(matrix, rhs) {
  const n = rhs.length;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(matrix[row]?.[col] ?? 0) > Math.abs(matrix[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = /** @type {number[]} */ (matrix[pivot]);
    if (Math.abs(pivotRow[col] ?? 0) < 1e-12) return null;
    [matrix[col], matrix[pivot]] = [pivotRow, /** @type {number[]} */ (matrix[col])];
    [rhs[col], rhs[pivot]] = [/** @type {number} */ (rhs[pivot]), /** @type {number} */ (rhs[col])];
    const top = /** @type {number[]} */ (matrix[col]);
    for (let row = col + 1; row < n; row += 1) {
      const current = /** @type {number[]} */ (matrix[row]);
      const factor = (current[col] ?? 0) / (top[col] ?? 1);
      for (let k = col; k < n; k += 1) current[k] = (current[k] ?? 0) - factor * (top[k] ?? 0);
      rhs[row] = (rhs[row] ?? 0) - factor * (rhs[col] ?? 0);
    }
  }
  const solution = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    const current = /** @type {number[]} */ (matrix[row]);
    let sum = rhs[row] ?? 0;
    for (let k = row + 1; k < n; k += 1) sum -= (current[k] ?? 0) * solution[k];
    solution[row] = sum / (current[row] ?? 1);
  }
  return solution;
}

/**
 * Least-squares fit of y = sum(coefficient_j x basis_j(N)).
 * @param {Array<{ n: number, y: number }>} points
 * @param {Array<(n: number) => number>} basis
 */
function leastSquares(points, basis) {
  const size = basis.length;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  const rhs = new Array(size).fill(0);
  for (const { n, y } of points) {
    const terms = basis.map((f) => f(n));
    for (let i = 0; i < size; i += 1) {
      rhs[i] += (terms[i] ?? 0) * y;
      const row = /** @type {number[]} */ (matrix[i]);
      for (let j = 0; j < size; j += 1) {
        row[j] = (row[j] ?? 0) + (terms[i] ?? 0) * (terms[j] ?? 0);
      }
    }
  }
  return solve(matrix, rhs);
}

/**
 * USL throughput at concurrency n.
 * @param {{ lambda: number, sigma: number, kappa: number }} model
 * @param {number} n
 */
export function uslThroughput(model, n) {
  return (model.lambda * n) / (1 + model.sigma * (n - 1) + model.kappa * n * (n - 1));
}

/**
 * Fit the Universal Scalability Law, X(N) = lambda N / (1 + sigma (N-1) + kappa N (N-1)),
 * where sigma is contention (queueing for shared resources) and kappa is coherency
 * (cost of keeping work consistent, which makes throughput fall past a peak).
 *
 * N / X(N) is linear in the unknowns, so the fit is ordinary least squares on
 * N/X = a + b (N-1) + c N (N-1), with lambda = 1/a, sigma = b/a, kappa = c/a.
 * Coefficients are physically non-negative; a negative estimate is refitted at zero.
 * @param {Array<{ concurrency: number, throughput: number }>} data
 */
export function fitUsl(data) {
  const points = data
    .filter((d) => d.concurrency > 0 && d.throughput > 0)
    .map((d) => ({ n: d.concurrency, y: d.concurrency / d.throughput, x: d.throughput }));
  if (points.length < 4) {
    return {
      ok: /** @type {const} */ (false),
      reason: `needs at least 4 load levels with successful throughput, got ${points.length}`,
    };
  }
  const one = () => 1;
  const contention = (/** @type {number} */ n) => n - 1;
  const coherency = (/** @type {number} */ n) => n * (n - 1);
  /** @type {Array<{ basis: Array<(n: number) => number>, map: (c: number[]) => { lambda: number, sigma: number, kappa: number } }>} */
  const candidates = [
    {
      basis: [one, contention, coherency],
      map: ([a = 1, b = 0, c = 0]) => ({ lambda: 1 / a, sigma: b / a, kappa: c / a }),
    },
    {
      basis: [one, contention],
      map: ([a = 1, b = 0]) => ({ lambda: 1 / a, sigma: b / a, kappa: 0 }),
    },
    {
      basis: [one, coherency],
      map: ([a = 1, c = 0]) => ({ lambda: 1 / a, sigma: 0, kappa: c / a }),
    },
    { basis: [one], map: ([a = 1]) => ({ lambda: 1 / a, sigma: 0, kappa: 0 }) },
  ];
  for (const candidate of candidates) {
    const coefficients = leastSquares(points, candidate.basis);
    if (!coefficients) continue;
    const model = candidate.map(coefficients);
    if (!(model.lambda > 0) || model.sigma < 0 || model.kappa < 0) continue;

    const mean = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const residual = points.reduce((sum, p) => sum + (p.x - uslThroughput(model, p.n)) ** 2, 0);
    const total = points.reduce((sum, p) => sum + (p.x - mean) ** 2, 0);
    // With coherency, throughput peaks at N* = sqrt((1 - sigma) / kappa) and falls beyond it.
    // Without it, throughput approaches lambda / sigma asymptotically.
    const peakConcurrency =
      model.kappa > 0 && model.sigma < 1 ? Math.sqrt((1 - model.sigma) / model.kappa) : null;
    const peakThroughput =
      peakConcurrency !== null
        ? uslThroughput(model, peakConcurrency)
        : model.sigma > 0
          ? model.lambda / model.sigma
          : null;
    return {
      ok: /** @type {const} */ (true),
      ...model,
      rSquared: total > 0 ? 1 - residual / total : 1,
      // R squared can look good while individual levels are far off, so report the worst miss too.
      maxRelativeError: Math.max(
        ...points.map((p) => Math.abs(uslThroughput(model, p.n) - p.x) / p.x),
      ),
      peakConcurrency,
      peakThroughput,
      points: points.length,
    };
  }
  return {
    ok: /** @type {const} */ (false),
    reason: 'no USL model with non-negative coefficients fits the data',
  };
}

/**
 * Turn a measured limit into an operating limit and an instance count.
 * @param {object} input
 * @param {number} input.kneeThroughput   Highest healthy throughput measured, transactions/s.
 * @param {number} input.headroom         Share of the knee kept in reserve (0 to 1).
 * @param {number} input.peakDemand       Forecast peak demand today, transactions/s.
 * @param {number} input.growthFactor     Demand multiplier over the planning horizon.
 * @param {number} input.redundantInstances  Extra instances for failure tolerance (N+1 is 1).
 * @param {number} input.instancesTested  Instances behind the endpoint during the test.
 */
export function sizeCapacity(input) {
  for (const [key, value] of Object.entries(input)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a number >= 0`);
  }
  if (!(input.headroom < 1)) throw new Error('headroom must be below 1');
  if (!(input.instancesTested >= 1) || !(input.kneeThroughput > 0)) {
    throw new Error('instancesTested must be >= 1 and kneeThroughput > 0');
  }
  const safeCapacity = input.kneeThroughput * (1 - input.headroom);
  const safePerInstance = safeCapacity / input.instancesTested;
  const futureDemand = input.peakDemand * input.growthFactor;
  // Assumes capacity scales linearly with instance count, which only holds while
  // no shared dependency (database, cache, network) becomes the bottleneck.
  const forLoad = Math.max(1, Math.ceil(futureDemand / safePerInstance - 1e-9));
  return {
    safeCapacity,
    safePerInstance,
    utilisationAtPeak: input.peakDemand / input.kneeThroughput,
    peakWithinSafeCapacity: input.peakDemand <= safeCapacity,
    futureDemand,
    instancesForLoad: forLoad,
    instancesRecommended: forLoad + input.redundantInstances,
  };
}
