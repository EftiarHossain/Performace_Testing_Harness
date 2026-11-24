#!/usr/bin/env node
// Run wrapper: the one supported way to start a test. It checks the target is
// allowed before k6 starts, passes run parameters to the k6 script, watches the
// load generator, and writes a run directory with the normalised result.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertTargetAllowed, resolveEnvironment } from '../src/lib/guard.js';
import { buildPlan } from '../src/lib/plan.js';
import { validateWorkload } from '../src/lib/workload.js';
import { assessGenerator, sampleProcess } from './lib/generator.js';
import { renderReport } from './lib/report.js';
import { buildResult, stableHash } from './lib/result.js';
import { readSummary } from './lib/summary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: node tools/run.js <profile> [options]

Options:
  --env <name>          Environment from config/environments.json (default: HARNESS_ENV or "local")
  --service <name>      Service under config/services/ (default: "example")
  --time-scale <0..1>   Shorten every stage, for development runs only (default: 1)
  --vus <n>             Force pre-allocated VUs per scenario (default: sized from the workload)
  --allow-production    Permit an environment marked production
  --help                Show this help

Exit codes: 0 pass, 99 SLO thresholds failed, 3 run invalid (not trustworthy),
2 did not start, anything else is k6's own error code.
`;

export const EXIT = { pass: 0, fail: 99, invalid: 3, notStarted: 2 };

/** @param {string} command @param {string[]} args */
function capture(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

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

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help || !cli.profile) {
    console.log(USAGE);
    return EXIT.pass;
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
  const serviceDir = `config/services/${cli.service}`;
  if (!existsSync(path.join(ROOT, serviceDir, 'workload.json'))) {
    throw new Error(`No workload model at ${serviceDir}/workload.json`);
  }
  const workload = validateWorkload(readJson(`${serviceDir}/workload.json`));
  const slo = readJson(`${serviceDir}/slo.json`);
  const plan = buildPlan(profile, workload, { timeScale: cli.timeScale, vuOverride: cli.vus });

  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}_${cli.service}_${cli.profile}`;
  const runDir = path.join(ROOT, 'results', runId);
  mkdirSync(runDir, { recursive: true });
  const summaryFile = path.join(runDir, 'k6-summary.json');

  const peak = Math.max(...plan.windows.map((window) => window.targetRate));
  console.log(
    `profile=${cli.profile} service=${cli.service} env=${envName} target=${environment.baseUrl}\n` +
      `duration=${plan.totalSeconds}s peak=${peak}/s windows=${plan.windows.length}` +
      (cli.timeScale < 1 ? ` (time-scale ${cli.timeScale}: development run, not a full test)` : ''),
  );

  const child = spawn('k6', ['run', path.join(ROOT, 'src/main.ts')], {
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
      HARNESS_SUMMARY_FILE: summaryFile,
    },
  });
  const sampler = child.pid ? sampleProcess(child.pid) : undefined;
  const k6ExitCode = await new Promise((resolve, reject) => {
    child.on('error', (error) => reject(new Error(`Could not start k6: ${error.message}`)));
    child.on('close', (code) => resolve(code ?? 1));
  });
  const samples = sampler?.stop() ?? [];

  if (!existsSync(summaryFile)) {
    // k6 failed before the end-of-test summary (script error, interrupted run).
    console.error(`error: k6 exited with code ${k6ExitCode} without writing a summary`);
    return k6ExitCode === 0 ? 1 : k6ExitCode;
  }

  const result = buildResult({
    summary: readSummary(JSON.parse(readFileSync(summaryFile, 'utf8'))),
    plan,
    profile,
    workload,
    slo,
    k6ExitCode,
    generator: assessGenerator(samples, {
      cores: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    }),
    run: {
      id: runId,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      service: cli.service,
      profile: cli.profile,
      // The environment's name, not its URL: results may be shared, hostnames may be private.
      environment: envName,
      timeScale: cli.timeScale,
      vuOverride: cli.vus ?? null,
      workloadVersion: workload.version,
      workloadHash: stableHash(workload),
      sloHash: stableHash(slo),
      profileHash: stableHash(profile),
      gitCommit: capture('git', ['rev-parse', '--short', 'HEAD']) || null,
      gitDirty: capture('git', ['status', '--porcelain']) !== '',
      k6Version: capture('k6', ['version']).split(' ')[1] ?? 'unknown',
      generatorHost: `${os.platform()}/${os.arch()}`,
    },
  });
  writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(path.join(runDir, 'generator-samples.json'), `${JSON.stringify(samples)}\n`);

  console.log(`\n${renderReport(result)}`);
  console.log(`Result: ${path.relative(process.cwd(), path.join(runDir, 'result.json'))}`);
  if (result.verdict === 'error') return k6ExitCode;
  return EXIT[result.verdict];
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = EXIT.notStarted;
  }
}
