#!/usr/bin/env node
// Compare a run against its baseline and exit non-zero on regression.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { comparabilityProblems, compareResults, renderComparison } from './lib/compare.js';
import { baselinePath, loadRun, ROOT } from './lib/runs.js';

const USAGE = `Usage: node tools/compare.js <run> [--baseline <file>] [--tolerances <file>]

<run> is a run directory, a result.json file, or "latest".
Without --baseline, the stored baseline for the run's service, environment and
profile is used. Tolerances default to config/compare.json.

Exit codes: 0 no regression, 1 regression, 2 could not compare.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      baseline: { type: 'string' },
      tolerances: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 2;
  } else {
    const current = loadRun(/** @type {string} */ (positionals[0]));
    const baselineFile = values.baseline ?? baselinePath(current.result.run);
    if (!existsSync(baselineFile)) {
      throw new Error(
        `No baseline at ${path.relative(process.cwd(), baselineFile)}. ` +
          'Create one from a passing run with: node tools/baseline.js save <run>',
      );
    }
    const baseline = loadRun(baselineFile);
    const problems = comparabilityProblems(baseline.result, current.result);
    if (problems.length > 0)
      throw new Error(`Runs are not comparable:\n  - ${problems.join('\n  - ')}`);

    const tolerances = JSON.parse(
      readFileSync(values.tolerances ?? path.join(ROOT, 'config/compare.json'), 'utf8'),
    );
    const comparison = compareResults(baseline.result, current.result, tolerances);
    console.log(
      renderComparison(comparison, {
        baselineId: baseline.result.run.id,
        currentId: current.result.run.id,
      }),
    );
    process.exitCode = comparison.regressed.length === 0 ? 0 : 1;
  }
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
