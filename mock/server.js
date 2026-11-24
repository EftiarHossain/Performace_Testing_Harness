// Dependency-free mock system under test. Run: node mock/server.js
// Configure with MOCK_PORT, MOCK_WORKERS, MOCK_SERVICE_MS, MOCK_QUEUE_LIMIT, MOCK_JITTER.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WorkerPool } from './pool.js';

/** Relative service-time cost per endpoint; capacity for a mix follows from these. */
export const ENDPOINT_COST = { login: 1.5, list: 1.0, read: 0.5, write: 2.0 };

export const DEFAULTS = { port: 3333, workers: 8, serviceMs: 40, queueLimit: 64, jitter: 0.2 };

const ITEM_COUNT = 1000;

/** @param {NodeJS.ProcessEnv} env */
export function configFromEnv(env) {
  /** @param {string} name @param {number} fallback */
  const number = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number >= 0`);
    return value;
  };
  return {
    port: number('MOCK_PORT', DEFAULTS.port),
    workers: number('MOCK_WORKERS', DEFAULTS.workers),
    serviceMs: number('MOCK_SERVICE_MS', DEFAULTS.serviceMs),
    queueLimit: number('MOCK_QUEUE_LIMIT', DEFAULTS.queueLimit),
    jitter: number('MOCK_JITTER', DEFAULTS.jitter),
  };
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** @param {http.IncomingMessage} req */
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return undefined;
  }
}

/**
 * Match a request to an endpoint. Returns undefined for unknown routes.
 * @param {string} method
 * @param {string} path
 * @returns {{ name: keyof typeof ENDPOINT_COST, id?: number } | undefined}
 */
function route(method, path) {
  if (method === 'POST' && path === '/auth/login') return { name: 'login' };
  if (method === 'GET' && path === '/items') return { name: 'list' };
  if (method === 'POST' && path === '/items') return { name: 'write' };
  const read = method === 'GET' ? /^\/items\/(\d+)$/.exec(path) : null;
  if (read) return { name: 'read', id: Number(read[1]) };
  return undefined;
}

/** @param {Omit<ReturnType<typeof configFromEnv>, 'port'>} config */
export function createMockServer(config) {
  const pool = new WorkerPool(config);
  let nextId = ITEM_COUNT + 1;

  return http.createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = req.method ?? 'GET';

    // Operational endpoints bypass the pool so they stay responsive under overload,
    // the way a real service's health and metrics endpoints should.
    if (path === '/healthz') return sendJson(res, 200, { status: 'ok' });
    if (path === '/__admin/stats') return sendJson(res, 200, { config, pool: pool.snapshot() });

    const matched = route(method, path);
    if (!matched) return sendJson(res, 404, { error: 'not found' });

    const body = method === 'POST' ? await readJson(req) : {};
    if (body === undefined) return sendJson(res, 400, { error: 'invalid JSON' });

    if (
      matched.name !== 'login' &&
      !/^Bearer mock-token-.+/.test(req.headers.authorization ?? '')
    ) {
      return sendJson(res, 401, { error: 'missing or invalid bearer token' });
    }
    if (matched.name === 'login' && (!body.username || !body.password)) {
      return sendJson(res, 400, { error: 'username and password are required' });
    }
    if (matched.name === 'write' && typeof body.name !== 'string') {
      return sendJson(res, 400, { error: 'name is required' });
    }

    const served = await pool.serve(ENDPOINT_COST[matched.name]);
    if (!served) return sendJson(res, 503, { error: 'overloaded' }, { 'retry-after': '1' });

    switch (matched.name) {
      case 'login':
        return sendJson(res, 200, { token: `mock-token-${body.username}` });
      case 'list':
        return sendJson(res, 200, {
          items: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` })),
          total: ITEM_COUNT,
        });
      case 'read': {
        const id = matched.id ?? 0;
        if (id < 1 || id > ITEM_COUNT) return sendJson(res, 404, { error: 'no such item' });
        return sendJson(res, 200, { id, name: `item-${id}` });
      }
      case 'write':
        return sendJson(res, 201, { id: nextId++, name: body.name });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = configFromEnv(process.env);
  const server = createMockServer(config);
  server.listen(config.port, '127.0.0.1', () => {
    const perSecond = config.workers / (config.serviceMs / 1000);
    console.log(
      `mock SUT on http://127.0.0.1:${config.port} | workers=${config.workers} ` +
        `serviceMs=${config.serviceMs} queueLimit=${config.queueLimit} | ` +
        `capacity for cost-1.0 requests: ${perSecond.toFixed(0)} req/s`,
    );
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(() => process.exit(0)));
}
