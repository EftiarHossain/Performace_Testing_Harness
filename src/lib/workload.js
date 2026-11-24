// Pure module (no k6 imports): the workload model is data; this validates it and
// selects transactions according to the declared mix.

/**
 * @typedef {object} Workload
 * @property {string} service
 * @property {string} version
 * @property {number} peakRate              Transactions per second at production peak.
 * @property {number} maxIterationSeconds   Longest iteration to budget VUs for.
 * @property {string} requestTimeout
 * @property {Array<{ name: string, weight: number }>} transactions
 * @property {{ minSeconds: number, maxSeconds: number }} [thinkTime]
 * @property {Record<string, string>} [data]
 */

/**
 * @param {any} raw
 * @returns {Workload}
 */
export function validateWorkload(raw) {
  /** @param {boolean} ok @param {string} message */
  const need = (ok, message) => {
    if (!ok) throw new Error(`Invalid workload model: ${message}`);
  };
  need(raw && typeof raw === 'object', 'must be an object');
  need(typeof raw.service === 'string' && raw.service !== '', 'service is required');
  need(typeof raw.version === 'string', 'version must be a string');
  need(Number.isFinite(raw.peakRate) && raw.peakRate > 0, 'peakRate must be > 0');
  need(
    Number.isFinite(raw.maxIterationSeconds) && raw.maxIterationSeconds > 0,
    'maxIterationSeconds must be > 0',
  );
  need(typeof raw.requestTimeout === 'string', 'requestTimeout must be a duration string');
  need(Array.isArray(raw.transactions) && raw.transactions.length > 0, 'transactions is empty');
  const seen = new Set();
  for (const tx of raw.transactions) {
    need(
      /^[a-z][a-z0-9_]*$/.test(tx.name ?? ''),
      `transaction name "${tx.name}" must be snake_case`,
    );
    need(!seen.has(tx.name), `duplicate transaction "${tx.name}"`);
    need(Number.isFinite(tx.weight) && tx.weight > 0, `weight of "${tx.name}" must be > 0`);
    seen.add(tx.name);
  }
  if (raw.thinkTime) {
    const { minSeconds, maxSeconds } = raw.thinkTime;
    need(
      minSeconds >= 0 && maxSeconds >= minSeconds,
      'thinkTime needs 0 <= minSeconds <= maxSeconds',
    );
  }
  return raw;
}

/**
 * Weighted random choice of the next transaction.
 * @param {Workload} workload
 * @param {number} random Uniform value in [0, 1).
 * @returns {string}
 */
export function pickTransaction(workload, random) {
  const total = workload.transactions.reduce((sum, tx) => sum + tx.weight, 0);
  let remaining = random * total;
  for (const tx of workload.transactions) {
    remaining -= tx.weight;
    if (remaining < 0) return tx.name;
  }
  // Floating-point edge when random is extremely close to 1.
  return /** @type {{ name: string }} */ (workload.transactions.at(-1)).name;
}
