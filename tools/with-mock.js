#!/usr/bin/env node
// Runs a command with the bundled mock service started for its duration:
//   node tools/with-mock.js node tools/run.js smoke
// Used by CI and the quick start so that starting, waiting for and stopping the
// mock is one step. Mock settings come from MOCK_* environment variables.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node tools/with-mock.js <command> [args...]');
  process.exit(2);
}

const port = process.env.MOCK_PORT ?? '3333';
const mock = spawn(process.execPath, [path.join(ROOT, 'mock/server.js')], { stdio: 'inherit' });
let mockExited = false;
mock.on('exit', () => {
  mockExited = true;
});

/** Wait until the mock answers its health check, or fail if it never does. */
async function waitUntilHealthy() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (mockExited)
      throw new Error('the mock service exited during start-up (is the port in use?)');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the mock service did not become healthy within 5 seconds');
}

try {
  await waitUntilHealthy();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (status) => resolve(status ?? 1));
  });
  process.exitCode = /** @type {number} */ (code);
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
} finally {
  mock.kill('SIGTERM');
}
