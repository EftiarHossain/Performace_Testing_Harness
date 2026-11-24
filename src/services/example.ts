// Transactions for the bundled mock service. This file is the template for
// onboarding a real service: one function per transaction named in the workload
// model, each using the client so requests are tagged and checked consistently.
import { loginAll, tokenForVu, type Credentials } from '../lib/auth.ts';
import type { Context } from '../lib/context.ts';
import { loadJsonArray, randomInt } from '../lib/data.ts';
import type { Client } from '../lib/http.ts';
import type { Service } from './index.ts';

/** What setup() hands to every iteration. Must be JSON-serialisable (a k6 rule). */
interface Data {
  tokens: string[];
}

const ITEM_COUNT = 1000;

function login(client: Client, user: Credentials): string | undefined {
  const response = client.post('/auth/login', user, {
    endpoint: 'POST /auth/login',
    checks: { 'has token': (r) => typeof r.json('token') === 'string' },
  });
  return response.status === 200 ? (response.json('token') as string) : undefined;
}

export function createExampleService(context: Context, client: Client): Service<Data> {
  // Init context: data files can only be opened here, not inside iterations.
  const dataFile = context.workload.data?.users;
  if (!dataFile) throw new Error('example workload must declare data.users');
  const users = loadJsonArray<{ username: string }>('users', `${context.serviceDir}/${dataFile}`);
  const password = __ENV.SUT_PASSWORD;
  if (!password) throw new Error('SUT_PASSWORD is not set (copy .env.example to .env)');

  return {
    setup: () => ({
      tokens: loginAll(
        client,
        users.map((user) => ({ username: user.username, password })),
        login,
      ),
    }),

    transactions: {
      list_items(data) {
        client.get('/items', {
          endpoint: 'GET /items',
          token: tokenForVu(data.tokens),
          checks: { 'returns items': (r) => Array.isArray(r.json('items')) },
        });
      },

      read_item(data) {
        const id = randomInt(1, ITEM_COUNT);
        client.get(`/items/${id}`, {
          endpoint: 'GET /items/:id',
          token: tokenForVu(data.tokens),
          checks: { 'returns the requested item': (r) => r.json('id') === id },
        });
      },

      create_item(data) {
        client.post(
          '/items',
          { name: `perf-item-${Date.now()}` },
          {
            endpoint: 'POST /items',
            expectedStatus: 201,
            token: tokenForVu(data.tokens),
            checks: { 'returns new id': (r) => typeof r.json('id') === 'number' },
          },
        );
      },

      login() {
        const user = users[randomInt(0, users.length - 1)] as { username: string };
        login(client, { username: user.username, password });
      },
    },
  };
}
