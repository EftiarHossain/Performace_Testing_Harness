// Load-generator health. A saturated generator under-delivers load and inflates
// measured latency, so its numbers would be blamed on the system under test.
import { execFile } from 'node:child_process';

/** Sustained CPU above this share of all cores means the generator is the bottleneck. */
const CPU_SATURATION_FRACTION = 0.8;
/** Consecutive samples above the limit before calling it sustained (ignores brief spikes). */
const SATURATED_SAMPLES = 3;
const MEMORY_SATURATION_FRACTION = 0.9;

/**
 * @typedef {{ cpuPercent: number, rssBytes: number }} Sample
 */

/**
 * Sample a process's CPU and memory until stop() is called.
 * Uses ps, which reports the same columns on macOS and Linux.
 * @param {number} pid
 * @param {number} intervalMs
 */
export function sampleProcess(pid, intervalMs = 1000) {
  /** @type {Sample[]} */
  const samples = [];
  const timer = setInterval(() => {
    execFile('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], (error, stdout) => {
      if (error) return; // The process has exited or ps is unavailable; keep what we have.
      const [cpu, rssKb] = stdout.trim().split(/\s+/).map(Number);
      if (
        cpu !== undefined &&
        rssKb !== undefined &&
        Number.isFinite(cpu) &&
        Number.isFinite(rssKb)
      ) {
        samples.push({ cpuPercent: cpu, rssBytes: rssKb * 1024 });
      }
    });
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      return samples;
    },
  };
}

/**
 * @param {Sample[]} samples
 * @param {{ cores: number, totalMemoryBytes: number }} host
 */
export function assessGenerator(samples, host) {
  // ps reports CPU as a percentage of one core, so all cores busy is cores x 100.
  const cpuLimit = host.cores * 100 * CPU_SATURATION_FRACTION;
  let streak = 0;
  let longestStreak = 0;
  for (const sample of samples) {
    streak = sample.cpuPercent > cpuLimit ? streak + 1 : 0;
    longestStreak = Math.max(longestStreak, streak);
  }
  const cpu = samples.map((sample) => sample.cpuPercent);
  const rssMax = Math.max(0, ...samples.map((sample) => sample.rssBytes));
  /** @type {string[]} */
  const problems = [];
  if (longestStreak >= SATURATED_SAMPLES) {
    problems.push(
      `load generator CPU stayed above ${CPU_SATURATION_FRACTION * 100}% of ${host.cores} cores ` +
        `for ${longestStreak} consecutive samples`,
    );
  }
  if (rssMax > host.totalMemoryBytes * MEMORY_SATURATION_FRACTION) {
    problems.push(
      `load generator memory exceeded ${MEMORY_SATURATION_FRACTION * 100}% of host memory`,
    );
  }
  return {
    samples: samples.length,
    cores: host.cores,
    cpuPercentAvg: cpu.length ? round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null,
    cpuPercentMax: cpu.length ? Math.max(...cpu) : null,
    rssMbMax: samples.length ? round(rssMax / 1024 / 1024) : null,
    problems,
  };
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 10) / 10;
}
