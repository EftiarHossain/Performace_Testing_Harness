#!/usr/bin/env node
// Run wrapper: the one supported way to start a test. It checks the target is
// allowed before k6 starts, passes run parameters to the k6 script, and returns
// k6's exit code so CI can gate on it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertTargetAllowed, resolveEnvironment } from '../src/lib/guard.js';
import { buildPlan } from '../src/lib/plan.js';
import { validateWorkload } from '../src/lib/workload.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: node tools/run.js <profile> [options]

Options:
  --env <name>          Environment from config/environments.json (default: HARNESS_ENV or "local")
  --service <name>      Service under config/services/ (default: "example")
  --time-scale <0..1>   Shorten every stage, for development runs only (default: 1)
  --vus <n>             Force pre-allocated VUs per scenario (default: sized from the workload)
  --allow-production    Permit an environment marked production
  --help                Show this help
`;

/** @param {string} relative */
function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

/** @param {string[]} argv */
export function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      env: { type: 'string' },
      service: { type: 'string', default: 'example' },
      'time-scale': { type: 'string', default: '1' },
      vus: { type: 'string' },
      'allow-production': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { help: true };
  if (positionals.length !== 1) throw new Error('Exactly one profile name is required');
  const timeScale = Number(values['time-scale']);
  if (!(timeScale > 0 && timeScale <= 1)) throw new Error('--time-scale must be in (0, 1]');
  const vus = values.vus === undefined ? undefined : Number(values.vus);
  if (vus !== undefined && !(Number.isInteger(vus) && vus > 0)) {
    throw new Error('--vus must be a positive integer');
  }
  return {
    help: false,
    profile: /** @type {string} */ (positionals[0]),
    env: values.env,
    service: /** @type {string} */ (values.service),
    timeScale,
    vus,
    allowProduction: values['allow-production'] === true,
  };
}

function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help || !cli.profile) {
    console.log(USAGE);
    return 0;
  }

  const envFile = path.join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const envName = cli.env ?? process.env.HARNESS_ENV ?? 'local';

  // Fail here, with a clear message, rather than inside k6's init output.
  const environment = resolveEnvironment(
    readJson('config/environments.json'),
    envName,
    process.env,
  );
  assertTargetAllowed(environment, { allowProduction: cli.allowProduction });
  const profiles = readJson('config/profiles.json');
  const profile = profiles[cli.profile];
  if (!profile) {
    throw new Error(`Unknown profile "${cli.profile}". Known: ${Object.keys(profiles).join(', ')}`);
  }
  const workloadFile = `config/services/${cli.service}/workload.json`;
  if (!existsSync(path.join(ROOT, workloadFile)))
    throw new Error(`No workload model at ${workloadFile}`);
  const workload = validateWorkload(readJson(workloadFile));
  const plan = buildPlan(profile, workload, { timeScale: cli.timeScale, vuOverride: cli.vus });

  const steady = plan.windows.filter((window) => window.phase === 'steady');
  const peak = Math.max(...plan.windows.map((window) => window.targetRate));
  console.log(
    `profile=${cli.profile} service=${cli.service} env=${envName} target=${environment.baseUrl}\n` +
      `duration=${plan.totalSeconds}s peak=${peak}/s steady windows=${steady.length}` +
      (cli.timeScale < 1 ? ` (time-scale ${cli.timeScale}: development run, not a full test)` : ''),
  );

  const result = spawnSync('k6', ['run', path.join(ROOT, 'src/main.ts')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HARNESS_ROOT: ROOT,
      HARNESS_ENV: envName,
      HARNESS_SERVICE: cli.service,
      HARNESS_PROFILE: cli.profile,
      HARNESS_TIME_SCALE: String(cli.timeScale),
      HARNESS_VU_OVERRIDE: cli.vus === undefined ? '' : String(cli.vus),
      HARNESS_ALLOW_PRODUCTION: String(cli.allowProduction),
    },
  });
  if (result.error) throw new Error(`Could not start k6: ${result.error.message}`);
  return result.status ?? 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    // Distinct from k6's own exit codes (99 = thresholds failed) so CI can tell
    // "did not run" from "ran and failed".
    process.exitCode = 2;
  }
}
