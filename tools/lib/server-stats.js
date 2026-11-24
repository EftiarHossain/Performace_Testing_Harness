// Server-side metrics hook. A load test shows where the limit is; identifying the
// resource that causes it needs the system's own metrics for the same window.
// This polls one JSON endpoint during the run and stores each response with a
// timestamp. It deliberately knows nothing about any monitoring stack: point
// `serverStatsUrl` at whatever returns the numbers you need (an admin or metrics
// endpoint, or a small exporter in front of your monitoring system).
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} url
 * @param {string} file  JSON Lines output: one `{ t, stats }` object per sample.
 * @param {number} [intervalMs]
 */
export function sampleServerStats(url, file, intervalMs = 2000) {
  let samples = 0;
  let errors = 0;
  /** @type {Promise<void>} */
  let inFlight = Promise.resolve();
  writeFileSync(file, '');

  const poll = async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(intervalMs) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      appendFileSync(
        file,
        `${JSON.stringify({ t: new Date().toISOString(), stats: await response.json() })}\n`,
      );
      samples += 1;
    } catch {
      // A failed poll must never disturb the test itself; it is counted and reported.
      errors += 1;
    }
  };
  inFlight = poll();
  const timer = setInterval(() => {
    inFlight = poll();
  }, intervalMs);

  return {
    async stop() {
      clearInterval(timer);
      await inFlight;
      return { file: path.basename(file), samples, errors, intervalMs };
    },
  };
}
