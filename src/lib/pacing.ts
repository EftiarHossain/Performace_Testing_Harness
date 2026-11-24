import { sleep } from 'k6';

/**
 * Pause as a user would between actions. Only meaningful in closed-model (VU-based)
 * scenarios, where it sets the request rate per user. In arrival-rate scenarios the
 * rate is fixed by the executor and think time would only tie up VUs, so do not call
 * it there.
 */
export function thinkTime(range: { minSeconds: number; maxSeconds: number }): void {
  sleep(range.minSeconds + Math.random() * (range.maxSeconds - range.minSeconds));
}
