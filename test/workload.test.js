import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pickTransaction, validateWorkload } from '../src/lib/workload.js';

const example = () => JSON.parse(readFileSync('config/services/example/workload.json', 'utf8'));

test('the example workload model is valid', () => {
  const workload = validateWorkload(example());
  assert.deepEqual(
    workload.transactions.map((tx) => [tx.name, tx.weight]),
    [
      ['list_items', 50],
      ['read_item', 35],
      ['create_item', 10],
      ['login', 5],
    ],
  );
});

test('validation names the problem', () => {
  /** @type {Array<[(w: any) => void, RegExp]>} */
  const cases = [
    [(w) => (w.peakRate = 0), /peakRate/],
    [(w) => (w.transactions = []), /transactions is empty/],
    [(w) => (w.transactions[0].weight = -1), /weight of "list_items"/],
    [(w) => (w.transactions[1].name = 'list_items'), /duplicate transaction/],
    [(w) => (w.transactions[0].name = 'List Items'), /snake_case/],
    [(w) => (w.thinkTime = { minSeconds: 3, maxSeconds: 1 }), /thinkTime/],
  ];
  for (const [mutate, expected] of cases) {
    const workload = example();
    mutate(workload);
    assert.throws(() => validateWorkload(workload), expected);
  }
});

test('pickTransaction follows the weights', () => {
  const workload = validateWorkload(example());
  assert.equal(pickTransaction(workload, 0), 'list_items');
  assert.equal(pickTransaction(workload, 0.4999), 'list_items');
  assert.equal(pickTransaction(workload, 0.5), 'read_item');
  assert.equal(pickTransaction(workload, 0.86), 'create_item');
  assert.equal(pickTransaction(workload, 0.96), 'login');
  assert.equal(pickTransaction(workload, 0.9999999999999999), 'login');

  /** @type {Record<string, number>} */
  const counts = {};
  const draws = 20000;
  for (let i = 0; i < draws; i += 1) {
    const name = pickTransaction(workload, (i + 0.5) / draws);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  assert.deepEqual(counts, { list_items: 10000, read_item: 7000, create_item: 2000, login: 1000 });
});
