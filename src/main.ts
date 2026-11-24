// Single k6 entry script for every service and profile. What runs is decided by
// configuration (see config/), selected through HARNESS_* environment variables
// that tools/run.js sets.
import { loadContext } from './lib/context.ts';
import { createClient } from './lib/http.ts';
import { assertImplemented, runIteration } from './lib/runner.ts';
import { createService } from './services/index.ts';

const context = loadContext();
const client = createClient(context.environment.baseUrl, context.workload.requestTimeout);
const service = createService(context.workload.service, context, client);
assertImplemented(context.workload, service.transactions);

export const options = context.options;

export function setup(): unknown {
  return service.setup();
}

export default function (data: unknown): void {
  runIteration(context.workload, service.transactions, data);
}

// tools/run.js normalises the summary in Node, where that logic can be unit-tested.
// Returning only a file also suppresses k6's console summary, which the wrapper
// replaces with its own report.
export function handleSummary(data: Record<string, unknown>): Record<string, string> {
  const file = __ENV.HARNESS_SUMMARY_FILE;
  if (!file) return { stdout: 'HARNESS_SUMMARY_FILE is not set; no summary written.\n' };
  // setup() data holds auth tokens and must never reach a results file.
  const safe = { ...data };
  delete safe.setup_data;
  return { [file]: JSON.stringify(safe) };
}
