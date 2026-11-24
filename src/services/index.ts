// Registry of services the harness can drive. k6 resolves imports statically,
// so a new service is added by importing it here.
import type { Context } from '../lib/context.ts';
import type { Client } from '../lib/http.ts';
import type { Transactions } from '../lib/runner.ts';
import { createExampleService } from './example.ts';

export interface Service<Data> {
  /** Runs once before load starts; its return value is passed to every iteration. */
  setup(): Data;
  transactions: Transactions<Data>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each service has its own Data type
type ServiceFactory = (context: Context, client: Client) => Service<any>;

const services: Record<string, ServiceFactory> = {
  example: createExampleService,
};

export function createService(name: string, context: Context, client: Client): Service<unknown> {
  const factory = services[name];
  if (!factory) {
    throw new Error(
      `Service "${name}" is not registered in src/services/index.ts. ` +
        `Known: ${Object.keys(services).join(', ')}`,
    );
  }
  return factory(context, client);
}
