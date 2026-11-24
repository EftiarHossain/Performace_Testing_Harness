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
