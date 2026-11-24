// Models a service with a fixed number of workers and a bounded wait queue.
// Because service time is simulated with timers rather than CPU work, the
// maximum sustainable throughput is known by construction:
//   capacity (req/s) = workers / mean service time (s)
// That known ground truth is what the harness's capacity analysis is verified against.

/**
 * @typedef {object} PoolConfig
 * @property {number} workers     Concurrent requests served at once.
 * @property {number} queueLimit  Requests allowed to wait; beyond this they are rejected.
 * @property {number} serviceMs   Base service time for a cost-1.0 request.
 * @property {number} jitter      Uniform +/- fraction applied to each service time (mean unchanged).
 */

export class WorkerPool {
  /** @param {PoolConfig} config */
  constructor(config) {
    this.config = config;
    this.busy = 0;
    /** @type {Array<() => void>} */
    this.waiting = [];
    this.stats = { served: 0, rejected: 0, maxQueued: 0 };
  }

  /**
   * Hold a worker for one request's simulated service time.
   * Resolves true when served, false when rejected because the queue was full.
   * @param {number} cost Multiplier on the base service time for this endpoint.
   * @returns {Promise<boolean>}
   */
  async serve(cost) {
    if (this.busy >= this.config.workers) {
      if (this.waiting.length >= this.config.queueLimit) {
        this.stats.rejected += 1;
        return false;
      }
      await new Promise((resolve) => {
        this.waiting.push(() => resolve(undefined));
        this.stats.maxQueued = Math.max(this.stats.maxQueued, this.waiting.length);
      });
    } else {
      this.busy += 1;
    }
    const { serviceMs, jitter } = this.config;
    const duration = serviceMs * cost * (1 + jitter * (Math.random() * 2 - 1));
    await new Promise((resolve) => setTimeout(resolve, duration));
    this.stats.served += 1;
    // Hand the worker straight to the next waiter (FIFO) so `busy` never dips
    // and a newly arriving request cannot jump the queue.
    const next = this.waiting.shift();
    if (next) next();
    else this.busy -= 1;
    return true;
  }

  snapshot() {
    return { busy: this.busy, queued: this.waiting.length, ...this.stats };
  }
}

/**
 * Theoretical maximum throughput for a request mix.
 * @param {Pick<PoolConfig, 'workers' | 'serviceMs'>} config
 * @param {Array<{ cost: number, weight: number }>} mix Endpoint costs with their share of traffic.
 * @returns {number} requests per second
 */
export function theoreticalCapacity(config, mix) {
  const totalWeight = mix.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) throw new Error('Mix weights must sum to a positive number');
  const meanCost = mix.reduce((sum, entry) => sum + entry.cost * entry.weight, 0) / totalWeight;
  return config.workers / ((config.serviceMs * meanCost) / 1000);
}
