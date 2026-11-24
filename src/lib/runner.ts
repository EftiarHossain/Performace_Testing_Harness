// Runs one transaction per iteration: chooses it from the workload mix, tags
// everything it emits with the transaction name, and records its outcome.
import exec from 'k6/execution';
import { hasFailedChecks, resetFailedChecks } from './http.ts';
import { transactionDuration, transactionFailed } from './metrics.ts';
import { pickTransaction, type Workload } from './workload.js';

export type Transactions<Data> = Record<string, (data: Data) => void>;

/** Fail at init, not mid-run, if the model names a transaction nobody implemented. */
export function assertImplemented(workload: Workload, transactions: Transactions<never>): void {
  const missing = workload.transactions.map((tx) => tx.name).filter((name) => !transactions[name]);
  if (missing.length > 0) {
    throw new Error(`Workload "${workload.service}" has unimplemented transactions: ${missing}`);
  }
}

export function runIteration<Data>(
  workload: Workload,
  transactions: Transactions<Data>,
  data: Data,
): void {
  const name = pickTransaction(workload, Math.random());
  const transaction = transactions[name] as (data: Data) => void;

  // VU-level tag: every metric emitted until the next iteration carries it,
  // including the built-in http_req_* metrics.
  exec.vu.metrics.tags.transaction = name;
  resetFailedChecks();
  const started = Date.now();
  let failed: boolean;
  try {
    transaction(data);
    failed = hasFailedChecks();
  } catch (error) {
    failed = true;
    console.error(`transaction ${name} threw: ${String(error)}`);
  }
  transactionFailed.add(failed);
  // Only successful transactions count towards latency: fast failures would
  // otherwise make an overloaded system look quick.
  if (!failed) transactionDuration.add(Date.now() - started);
}
