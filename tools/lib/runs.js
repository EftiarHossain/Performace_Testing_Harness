// Locating result documents on disk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Load a result from a run directory, a result.json path, or "latest"
 * (the most recent run under results/; run IDs start with a UTC timestamp, so
 * name order is time order).
 * @param {string} reference
 * @returns {{ result: any, file: string }}
 */
export function loadRun(reference) {
  let file = reference;
  if (reference === 'latest') {
    const resultsDir = path.join(ROOT, 'results');
    const runs = existsSync(resultsDir)
      ? readdirSync(resultsDir)
          .filter((name) => existsSync(path.join(resultsDir, name, 'result.json')))
          .sort()
      : [];
    const last = runs.at(-1);
    if (!last) throw new Error('No runs with a result.json found under results/');
    file = path.join(resultsDir, last, 'result.json');
  } else if (existsSync(reference) && statSync(reference).isDirectory()) {
    file = path.join(reference, 'result.json');
  }
  if (!existsSync(file)) throw new Error(`No result found at ${file}`);
  return { result: JSON.parse(readFileSync(file, 'utf8')), file };
}

/**
 * Baselines are kept per service, environment and profile: numbers from one
 * environment say nothing about another.
 * @param {{ service: string, environment: string, profile: string }} run
 */
export function baselinePath(run) {
  return path.join(ROOT, 'baselines', run.service, run.environment, `${run.profile}.json`);
}
