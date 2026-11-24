#!/usr/bin/env node
// Save a run as the baseline for its service, environment and profile.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateResult } from './lib/result.js';
import { baselinePath, loadRun } from './lib/runs.js';

const USAGE = `Usage: node tools/baseline.js save <run>

<run> is a run directory, a result.json file, or "latest".
The baseline is written to baselines/<service>/<environment>/<profile>.json and
is meant to be committed, so that later runs can be compared against it.
`;

try {
  const [command, reference] = process.argv.slice(2);
  if (command !== 'save' || !reference) {
    console.log(USAGE);
    process.exitCode = command === '--help' ? 0 : 2;
  } else {
    const { result, file } = loadRun(reference);
    const problems = validateResult(result);
    if (problems.length > 0)
      throw new Error(`${file} is not a valid result: ${problems.join('; ')}`);
    // A baseline that breached its SLOs or could not be trusted would make every later run look fine.
    if (result.verdict !== 'pass') {
      throw new Error(
        `Run ${result.run.id} has verdict "${result.verdict}"; only passing runs can become baselines`,
      );
    }
    const target = baselinePath(result.run);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      `Baseline saved: ${path.relative(process.cwd(), target)} (from run ${result.run.id})`,
    );
    if (result.run.timeScale < 1) {
      console.log(
        `Note: this run used time-scale ${result.run.timeScale}; it only compares with runs at the same scale.`,
      );
    }
  }
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
