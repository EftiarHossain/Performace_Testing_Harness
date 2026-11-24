import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertTargetAllowed, hostOf, resolveEnvironment } from '../src/lib/guard.js';

const environments = JSON.parse(readFileSync('config/environments.json', 'utf8'));

test('the bundled local environment is allowed', () => {
  const local = resolveEnvironment(environments, 'local', {});
  assert.equal(local.baseUrl, 'http://127.0.0.1:3333');
  assert.doesNotThrow(() => assertTargetAllowed(local));
});

test('refuses a host that is not in the allowlist', () => {
  const env = {
    name: 'x',
    baseUrl: 'https://api.example.com',
    allowedHosts: ['127.0.0.1'],
    production: false,
  };
  assert.throws(() => assertTargetAllowed(env), /not in the allowlist/);
  // Even the production override does not bypass the allowlist.
  assert.throws(() => assertTargetAllowed(env, { allowProduction: true }), /not in the allowlist/);
});

test('refuses lookalike hosts and embedded credentials', () => {
  const allowed = ['127.0.0.1', 'localhost'];
  for (const baseUrl of ['http://localhost.evil.test', 'http://127.0.0.1.evil.test:3333/x']) {
    const env = { name: 'x', baseUrl, allowedHosts: allowed, production: false };
    assert.throws(() => assertTargetAllowed(env), /not in the allowlist/);
  }
  // user@host forms could disguise the real host, so they are rejected outright.
  assert.throws(() => hostOf('http://localhost@evil.test/'), /Cannot determine host/);
  assert.throws(() => hostOf('ftp://localhost'), /Cannot determine host/);
});

test('refuses production without the explicit override', () => {
  const env = {
    name: 'prod',
    baseUrl: 'https://shop.test',
    allowedHosts: ['shop.test'],
    production: true,
  };
  assert.throws(() => assertTargetAllowed(env), /marked production/);
  assert.doesNotThrow(() => assertTargetAllowed(env, { allowProduction: true }));
});

test('an environment without a production flag is treated as production', () => {
  const env = resolveEnvironment(
    { x: { baseUrl: 'http://h.test', allowedHosts: ['h.test'] } },
    'x',
    {},
  );
  assert.equal(env.production, true);
});

test('placeholders are filled from environment variables and required', () => {
  const vars = { STAGING_BASE_URL: 'https://Stage.Test:8443/', STAGING_HOST: 'Stage.Test' };
  const staging = resolveEnvironment(environments, 'staging', vars);
  assert.equal(staging.baseUrl, 'https://Stage.Test:8443');
  assert.deepEqual(staging.allowedHosts, ['stage.test']);
  assert.doesNotThrow(() => assertTargetAllowed(staging));
  assert.throws(
    () => resolveEnvironment(environments, 'staging', {}),
    /STAGING_BASE_URL is required/,
  );
  assert.throws(() => resolveEnvironment(environments, 'nowhere', {}), /Unknown environment/);
});

test('hostOf handles ports, paths and case', () => {
  assert.equal(hostOf('http://127.0.0.1:3333'), '127.0.0.1');
  assert.equal(hostOf('HTTPS://API.Example.com/v1?x=1'), 'api.example.com');
});
