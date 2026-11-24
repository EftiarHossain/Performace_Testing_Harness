# Progress

Working memory for the build loop defined in `LOOP_PROMPT.md`. Read this first in every iteration.

## Environment (recorded 2026-11-24, iteration 1)

| Item   | Value                                                                |
| ------ | -------------------------------------------------------------------- |
| k6     | v1.6.1 (go1.26.0, darwin/arm64), installed at `/opt/homebrew/bin/k6` |
| Node   | v20.20.2                                                             |
| npm    | 10.8.2                                                               |
| OS     | macOS 14.6.1 (23G93), arm64                                          |
| git    | 2.47.0                                                               |
| Docker | not installed                                                        |

k6 compatibility target: write against 1.6.1 and avoid everything removed in 2.x (`externally-controlled` executor, `--no-summary`, legacy summary mode, `options.ext.loadimpact`). Do not use the built-in Prometheus remote-write or InfluxDB outputs (deprecated in later 2.x); use OpenTelemetry. Never parse the console summary; results come from `handleSummary` only, normalised into the harness's own schema.

## Milestones

Status values: `todo`, `in progress`, `done`. A milestone is `done` only when its check was run and passed, with the command and result recorded under "Verification log".

- [x] **1. Skeleton and conventions** (done, iteration 2). Layout, `package.json`, TypeScript config with k6 types, lint and format, `.env.example`, `.gitignore`. Check: type-check and lint pass.
- [x] **2. Mock service with a known capacity** (done, iteration 3). Dependency-free Node HTTP service (login, list, read, write), fixed worker pool and bounded queue, configurable. Check: starts, responds, and a quick overload shows 503s or latency growth near the designed limit.
- [x] **3. Core library** (done, iteration 4). Environment and allowlist guard, workload model loader, SLO-to-threshold compiler, tagged HTTP client with checks, auth helper, `SharedArray` test data, think time, custom metrics. Check: unit tests pass, including the guard refusing a non-allowlisted host.
- [x] **4. Profiles and entry script** (done, iteration 5). Smoke, average-load, stress, spike, soak, breakpoint, stair-step capacity; one run wrapper. Check: smoke and a shortened average-load run pass against the mock with thresholds green.
- [ ] **5. Results pipeline** (todo). `handleSummary`, normalised schema, run directory with metadata, validity verdict, generator resource capture. Check: a run produces a schema-valid result; an under-provisioned run is marked invalid.
- [ ] **6. Baseline and regression compare** (todo). Check: self-compare passes; after slowing the mock, compare exits non-zero and names the regressed transactions.
- [ ] **7. Capacity analysis** (todo). Knee detection, USL fit, headroom, sizing, Markdown report with chart. Check: detected knee within 15% of the mock's designed capacity; changing the mock's capacity moves the knee; fitting code unit-tested on synthetic data.
- [ ] **8. Observability hooks and CI** (todo). OpenTelemetry output config, server-metrics attachment hook, GitHub Actions workflows. Check: workflow files valid; smoke job commands run locally end to end.
- [ ] **9. Documentation** (todo). README, methodology guide, onboarding runbook, test plan template, capacity report template, troubleshooting, k6 compatibility notes. Check: quick start followed verbatim from a clean clone works.
- [ ] **10. Final acceptance** (todo). Clean clone: install, unit tests, smoke, baseline save and compare, stair-step and capacity report, all passing; repository review pass.

## Decisions

- **Layout** (iteration 1): see `CLAUDE.md`. k6 scripts in TypeScript under `src/`, run natively by k6. Analysis and tooling as plain Node ESM under `tools/` with no runtime dependencies. Mock service under `mock/`.
- **Pure logic is shared, not duplicated** (iteration 1): logic needed by both k6 scripts and Node tests (threshold compiler, guard, workload scaling) must avoid k6 imports so `node:test` can exercise it directly.
- **Unit tests** use the built-in `node:test` runner; no test framework dependency.
- **CI** is GitHub Actions (default from the brief; the user has not chosen otherwise).
- **Tooling** (iteration 2): one `tsconfig.json` type-checks `src`, `tools`, `mock`, `test` with both k6 and Node types; ESLint flat config gives `src/` only k6 globals and the rest Node globals. Dev dependencies: typescript, @types/k6, @types/node, eslint, @eslint/js, typescript-eslint, globals, prettier.
- **One iteration is one transaction** (iteration 4): the arrival rate is therefore transactions per second, which is the unit capacity is stated in. SLOs are judged on custom metrics `transaction_duration` (successful transactions only, so fast failures cannot flatter latency) and `transaction_failed` (transport error, unexpected status or failed check), not on `http_req_*`.
- **Every stage is its own scenario** (iteration 4): k6's summary cannot window by time, so steady-state measurement needs a scenario per hold stage. SLO thresholds apply to `phase:steady` only.
- **Gating versus exploratory profiles** (iteration 4): smoke, average-load and soak fail on SLO breach; stress, spike, breakpoint and capacity record the same metrics without gating (always-true thresholds, needed so k6 reports the submetrics) and carry abort thresholds instead.
- **Config is JSON** (iteration 4): readable by both k6 (`open`) and Node with no parser dependency.
- **Profiles are relative to the workload's `peakRate`** except smoke, which uses absolute rates.
- **Mock capacity** will be `workers / serviceTime`; default sized well under what a laptop can generate so the generator is never the bottleneck.

## Verification log

- Iteration 1 (bootstrap): environment commands run and recorded above. No milestone checks yet.
- Iteration 2 (milestone 1): `npm run typecheck` exit 0, `npm run lint` exit 0, `npm run format:check` exit 0, `npm test` 2 passed / 0 failed. Probe in scratchpad: k6 1.6.1 ran a `.ts` entry script importing both a relative `.js` module and a `.ts` module (output `double=42 helper=ok`).

- Iteration 3 (milestone 2): `npm run check` exit 0, 8 unit tests passed (pool rejection, pool throughput, endpoints, 503 under overload). Live check: `node mock/server.js` (defaults: 8 workers, 40 ms, queue 64, designed capacity 200 req/s for cost-1.0 requests), `/healthz` 200, then a scratch k6 script drove `GET /items` at three constant arrival rates for 15 s each:

  | Offered | Successful | Failed      | Median | p95    |
  | ------- | ---------- | ----------- | ------ | ------ |
  | 100/s   | 100.1/s    | 0.0%        | 41 ms  | 49 ms  |
  | 180/s   | 180.1/s    | 0.0%        | 41 ms  | 49 ms  |
  | 260/s   | 204.5/s    | 21.4% (503) | 351 ms | 368 ms |

  No dropped iterations. Mock stats: served 7269, rejected 833, max queued 64. Saturation sits at the designed 200 req/s.

- Iteration 4 (milestone 3): `npm run check` exit 0, 27 unit tests passed, including guard tests (non-allowlisted host refused even with the production override, lookalike hosts and `user@host` URLs refused, production refused without override, missing `production` flag treated as production). In-k6 checks with a scratch entry script importing every `src/lib/*.ts` module: `k6 inspect --include-system-env-vars` produced the expected smoke scenario and thresholds; the capacity profile produced 28 scenarios and 123 thresholds; with a staging URL whose host was not in the allowlist, k6 init failed with "Refusing to run: host ...". The k6-side modules (`http.ts`, `runner.ts`, `auth.ts`, `data.ts`, `pacing.ts`) are type-checked and load in k6 but have not yet executed requests; that happens in milestone 4.

- Iteration 5 (milestone 4): `npm run check` exit 0 (27 tests). With the mock running at defaults:
  - `node tools/run.js smoke`: exit 0, 60 of 60 iterations, 160 of 160 checks, every SLO threshold green (worst p95 96 ms against 300 ms for `create_item`), 0 dropped.
  - `node tools/run.js average-load --time-scale 0.03` (67 s, 100/s): exit 0, steady window delivered exactly 5400 iterations (100/s x 54 s), 0 failed, 0 dropped, 12136 of 12136 checks, per-transaction p95 25 to 96 ms, all SLO thresholds green.
  - Guard through the wrapper: staging URL with a host outside the allowlist exits 2 with "Refusing to run: host "api.example.com" is not in the allowlist"; unknown profile exits 2.
  - Confirmed: a `dropped_iterations` threshold passes when nothing is dropped, and `exec.vu.metrics.tags.transaction` tags the custom metrics (per-transaction submetrics have the right counts).
  - Not run in this iteration: stress, spike, soak, breakpoint and capacity profiles (they build valid plans in unit tests; breakpoint and capacity get executed in milestone 7).

## Notes for the next iteration

- Start milestone 5 (results pipeline): add `handleSummary` to `src/main.ts`, a normaliser to the harness's own versioned schema, a run directory `results/<timestamp>_<service>_<profile>/` written by `tools/run.js` with metadata (timestamp, git commit, k6 version, profile, environment, workload hash, time scale, plan windows with target and achieved rates, validity verdict), and load-generator CPU and memory capture during the run.
- Suggested split: `handleSummary` only dumps the raw k6 summary object to a file whose path the wrapper passes in (keeps k6-side logic minimal); the wrapper then normalises in Node (`tools/lib/`), where it is unit-testable. Enable `--new-machine-readable-summary` and dump its shape first; support whichever shape arrives if cheap, otherwise require the new one.
- Generator capture: sample the k6 child process with `ps -o %cpu=,rss= -p <pid>` on an interval (works on macOS and Linux). This needs `spawn` rather than `spawnSync` in `tools/run.js`.
- Validity verdict: invalid when dropped iterations exceed 1% of planned, when a steady window's achieved iterations fall short of planned by more than about 2%, or when generator CPU is saturated. A run aborted by an abort threshold in an exploratory profile is still valid up to the abort. Milestone 5's check needs `--vus 1` or similar on average-load to force drops.
- Verdict precedence for the wrapper's exit code: invalid (own exit code) over fail (k6 exit 99) over pass.
- Trend submetrics in the console summary include `count` (from `summaryTrendStats`), rate submetrics show passes and fails; verify the same fields exist in the machine-readable summary.
- Current run interface: `node tools/run.js <profile> [--env] [--service] [--time-scale] [--vus] [--allow-production]`; exit 2 means the run did not start. `.env` is loaded if present (`cp .env.example .env`; it holds `SUT_PASSWORD`).
- Adding a service: `config/services/<name>/{workload,slo}.json` plus data, `src/services/<name>.ts` exporting a factory, registered in `src/services/index.ts`.
- When capturing k6 output to a log, k6 prints progress lines repeatedly; filter them rather than grepping scenario names.
- The example mix gives the mock a designed capacity of 8 / (0.040 s x 0.95) = 210.5 transactions/s (mean cost 0.95), which is 2.1x the model's `peakRate` of 100.
- Mock facts: `node mock/server.js`, port 3333, env `MOCK_PORT`, `MOCK_WORKERS`, `MOCK_SERVICE_MS`, `MOCK_QUEUE_LIMIT`, `MOCK_JITTER`. Endpoints: `POST /auth/login` (JSON `username`, `password`; returns `token`), `GET /items`, `GET /items/:id` (1 to 1000), `POST /items` (JSON `name`, returns 201). All but login need `Authorization: Bearer <token>`. `/healthz` and `/__admin/stats` bypass the worker pool. Endpoint costs: login 1.5, list 1.0, read 0.5, write 2.0; `theoreticalCapacity(config, mix)` in `mock/pool.js` gives the designed capacity for a mix, and the capacity check in milestone 7 must use it with the example workload model's mix.
- Mock behaviour to design around: latency stays flat (about 41 ms median) until very close to capacity, then jumps to about 350 ms as the queue fills, with 503s for the excess. So the knee is sharp; the stair-step profile needs steps on both sides of 200 req/s and fine enough near it (for example 20 req/s steps) to land within the 15% tolerance.
- Successful throughput in the overloaded step read 204.5/s, slightly above 200, because the queue drains after the step ends. Analysis should count successful requests, not completed ones, and expect this small overshoot.
- Confirmed on k6 1.6.1: `.ts` scripts import relative `.js` and `.ts` modules (extensions required). Shared pure logic lives in `src/lib/*.js` with JSDoc types.
- Confirmed on k6 1.6.1: `--summary-mode compact|full|disabled`, `--new-machine-readable-summary`, `--summary-export` exist. Without the new flag `handleSummary` gets the legacy shape. In milestone 5 enable the new machine-readable summary explicitly and normalise from it; dump the shape first to verify.
- Per-scenario submetrics appear in the summary only when a threshold references them (for example `http_req_duration{scenario:step3}`), so the threshold compiler must emit a threshold for every submetric the analysis needs. Confirmed with the scratch script.
- Prettier formats Markdown too, so run `npm run format` before committing docs.

## Open questions for the user

None blocking. Defaults assumed: HTTP/REST targets, GitHub Actions, no Docker.

## Future work

(empty)
