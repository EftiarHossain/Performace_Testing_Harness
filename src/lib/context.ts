// Init-context loader: reads the run parameters and configuration files, applies
// the target guard, and builds the plan. Runs once per VU in k6's init stage, so
// everything here must be deterministic and free of network calls.
import { assertTargetAllowed, resolveEnvironment, type Environment } from './guard.js';
import { buildPlan, type Plan, type Profile } from './plan.js';
import { compileThresholds, sloTrendStats, type Slo } from './thresholds.js';
import { validateWorkload, type Workload } from './workload.js';

export interface Context {
  environment: Environment;
  profileName: string;
  profile: Profile;
  workload: Workload;
  slo: Slo;
  plan: Plan;
  serviceDir: string;
  options: object;
}

function required(name: string): string {
  const value = __ENV[name];
  if (!value) throw new Error(`${name} is not set. Start runs with "node tools/run.js".`);
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(open(path));
}

export function loadContext(): Context {
  // Paths are absolute because k6 resolves open() relative to the calling module,
  // which would tie configuration lookups to this file's location.
  const root = required('HARNESS_ROOT');
  const profileName = required('HARNESS_PROFILE');
  const serviceDir = `${root}/config/services/${required('HARNESS_SERVICE')}`;

  const environments = readJson(`${root}/config/environments.json`) as Parameters<
    typeof resolveEnvironment
  >[0];
  const environment = resolveEnvironment(environments, required('HARNESS_ENV'), __ENV);
  assertTargetAllowed(environment, {
    allowProduction: __ENV.HARNESS_ALLOW_PRODUCTION === 'true',
  });

  const profiles = readJson(`${root}/config/profiles.json`) as Record<string, Profile>;
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown profile "${profileName}". Known: ${Object.keys(profiles).join(', ')}`);
  }
  const workload = validateWorkload(readJson(`${serviceDir}/workload.json`));
  const slo = readJson(`${serviceDir}/slo.json`) as Slo;
  const transactions = workload.transactions.map((tx) => tx.name);

  const plan = buildPlan(profile, workload, {
    timeScale: __ENV.HARNESS_TIME_SCALE ? Number(__ENV.HARNESS_TIME_SCALE) : undefined,
    vuOverride: __ENV.HARNESS_VU_OVERRIDE ? Number(__ENV.HARNESS_VU_OVERRIDE) : undefined,
  });

  const options = {
    scenarios: plan.scenarios,
    thresholds: compileThresholds({
      slo,
      transactions,
      plan,
      gate: profile.gate,
      abort: profile.abort,
    }),
    // "count" lets throughput be derived from trend submetrics.
    summaryTrendStats: [
      ...new Set([
        'avg',
        'min',
        'med',
        'p(90)',
        'p(95)',
        'p(99)',
        ...sloTrendStats(slo, transactions),
      ]),
      'max',
      'count',
    ],
    // The harness tags requests itself; dropping the raw URL tag keeps metric
    // cardinality flat when paths contain IDs.
    systemTags: [
      'scenario',
      'status',
      'method',
      'name',
      'check',
      'error_code',
      'expected_response',
    ],
  };

  return { environment, profileName, profile, workload, slo, plan, serviceDir, options };
}
