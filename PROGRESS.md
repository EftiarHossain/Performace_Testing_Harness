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
- [x] **5. Results pipeline** (done, iteration 6). `handleSummary`, normalised schema, run directory with metadata, validity verdict, generator resource capture. Check: a run produces a schema-valid result; an under-provisioned run is marked invalid.
- [x] **6. Baseline and regression compare** (done, iteration 7). Check: self-compare passes; after slowing the mock, compare exits non-zero and names the regressed transactions.
- [x] **7. Capacity analysis** (done, iteration 8). Knee detection, USL fit, headroom, sizing, Markdown report with chart. Check: detected knee within 15% of the mock's designed capacity; changing the mock's capacity moves the knee; fitting code unit-tested on synthetic data.
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
- **Normalisation happens in Node, not in k6** (iteration 6): `handleSummary` only writes the raw summary (minus setup data, which holds tokens); `tools/lib/` turns it into the harness's schema, where it is unit-tested and independent of k6's summary format.
- **Validity is a verdict of its own** (iteration 6): dropped iterations above 1% of plan, a steady window running under 98% of its planned iterations, or a saturated generator (CPU above 80% of all cores for 3 consecutive one-second samples, or memory above 90% of host) make a run `invalid`, with its own exit code.
- **Throughput regressions are judged on the total, latency and errors per transaction** (iteration 7): random transaction selection makes per-transaction throughput vary run to run.
- **A latency regression needs both a relative and an absolute change** (iteration 7), so small latencies do not trip on noise. Tolerances are in `config/compare.json`.
- **Baselines are per service, environment and profile, and only passing runs can be saved** (iteration 7). Compare refuses runs whose workload hash, profile, profile definition, environment or time scale differ.
- **The knee is the last tested level within limits before the first that is not** (iteration 8). Limits: the service's default SLO (p95, p99, error rate) applied to all transactions together, plus served throughput at least 95% of offered. Later levels that look healthy again do not move it. The knee is accurate only to the step size.
- **USL is fitted by linear least squares on N/X** with concurrency from Little's law, coefficients constrained non-negative; the report gives R squared and the worst miss and defers to the measured knee when the fit is poor (iteration 8).
- **Sizing is only stated when a knee was found** (iteration 8): safe capacity = knee x (1 - headroom); instances = ceil(peak x growth / safe capacity per instance) + redundancy.
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

- Iteration 6 (milestone 5): `npm run check` exit 0, 38 unit tests passed (result builder, validity rules, both k6 summary formats, generator assessment, report). With the mock running:
  - `node tools/run.js average-load --time-scale 0.02`: exit 0, verdict PASS, steady window ran 3601 of 3600 planned at 100/s, 0 dropped, generator CPU avg 9.8% of one core, 167 MB. `validateResult` on the written `result.json` returned no problems.
  - `node tools/run.js average-load --time-scale 0.02 --vus 1` (deliberately under-provisioned): exit 3, verdict INVALID with two reasons: "k6 dropped 3083 iterations (more than 1% of the 4000 planned)" and "p02_steady: only 784 of 3600 planned iterations ran at 100/s". Latency in that run looked healthy (p95 82 ms), which is exactly why the validity check exists. Result also schema-valid.
  - Neither run's `k6-summary.json` contains auth tokens (the legacy summary includes `setup_data`; `handleSummary` strips it).
  - Not verified: the machine-readable summary path against a real k6 2.x binary (only 1.6.1 is installed). It is unit-tested against the shape 1.6.1 emits with `--new-machine-readable-summary`.

- Iteration 7 (milestone 6): `npm run check` exit 0, 47 unit tests passed. With the mock running, all runs `average-load --time-scale 0.02`:
  - `node tools/baseline.js save latest`: wrote `baselines/example/local/average-load.json`, exit 0.
  - `node tools/compare.js latest` on the baseline run itself: every row +0.0%, "NO REGRESSION", exit 0.
  - Mock restarted with `MOCK_SERVICE_MS=60`, new run, compare: exit 1, "REGRESSION in: list_items, read_item, create_item, login", latency percentiles +45% to +90% (for example `list_items` p95 50 ms to 73 ms). The slowed run itself still passed its SLOs, so only the compare caught it.
  - Refusals: comparing a smoke run to the average-load baseline exits 2 listing profile, profile definition and time scale differences; no baseline for the profile exits 2 with the command to create one.
  - **Defect found and fixed during the check:** the first repeat run on the unchanged mock was flagged as a regression in `create_item` (ok/s 11.1 to 10.2, -8.2%). Cause: each iteration picks its transaction at random, so per-transaction throughput varies several percent between identical runs. Throughput is now judged on the total across transactions (set by the arrival rate; 100.0 to 100.0 in that run). After the fix, that run and two further repeat runs on the unchanged mock all compared with exit 0, and the slowed run still exits 1.
  - Limit of this evidence: three repeat runs of 36 s steady state on one laptop. The default tolerances (10% and 5 ms on latency, 0.5 points on error rate, 5% on total throughput) are starting values, not calibrated ones.

- Iteration 8 (milestone 7): `npm run check` exit 0, 61 unit tests passed, including USL fits on synthetic data (exact recovery of lambda 12, sigma 0.05, kappa 0.0008 and the predicted peak; recovery within tolerance under +/-2% noise; contention-only and linear cases keep coefficients non-negative), knee detection on synthetic hard-limit systems of several capacities, and sizing arithmetic. Live, `node tools/run.js capacity --time-scale 0.04` (14 levels from 40 to 300/s, 7 s holds, about 112 s) then `node tools/capacity.js latest`:

  | Mock                | Designed capacity (example mix) | Detected knee | Difference | Ceiling | First level beyond                                               |
  | ------------------- | ------------------------------: | ------------: | ---------: | ------: | ---------------------------------------------------------------- |
  | 8 workers (default) |                         210.5/s |       200.1/s |      -4.9% | 220.1/s | 220/s: p95 276 ms >= 250 ms                                      |
  | `MOCK_WORKERS=4`    |                         105.3/s |       100.1/s |      -4.9% | 110.4/s | 120/s: p95 719 ms, failed 8.09%, throughput below 95% of offered |

  Both within the 15% tolerance, and the knee moved with the mock's capacity. Designed capacities computed with `theoreticalCapacity` from `mock/pool.js`. Both runs exit 0 (verdict PASS, exploratory). The 4-worker run was stopped early by the abort threshold during the 280/s level; the two incomplete levels were excluded and the report says so.
  - USL on the mock: sigma 0.091, kappa 0.000735, R squared 0.951, but worst miss 31% of measured throughput (the mock is linear up to a hard limit, which USL does not model). The report now states the worst miss and says to use the measured knee, not the predicted maximum, when R squared is below 0.9 or the worst miss exceeds 10%.
  - Chart rendered to PNG with `qlmanage` and inspected: two panels (throughput, p95), knee and SLO reference lines, no overlapping labels after two fixes (label position, then a background plate behind reference labels).
  - Limits of this evidence: 7 s holds are far short of steady state. At 220/s offered the default mock served 220.1/s with no failures because its 64-slot queue absorbed 7 s of excess, so the "ceiling" in a short run overstates the true ceiling (about 210/s). The knee was still caught there by p95. The report flags time-scaled runs as rehearsals.

## Notes for the next iteration

- Start milestone 8 (observability hooks and CI):
  - OpenTelemetry output: document and wire `--otel` (or pass-through of extra k6 args) in `tools/run.js` so `k6 run -o opentelemetry` (check the exact output name and env vars on 1.6.1 with `k6 run --help` and the versioned docs; `experimental-opentelemetry` was the old name) can be enabled without editing code. Do not use the Prometheus remote-write or InfluxDB outputs.
  - Server-metrics attachment hook: a way to attach server-side metrics to a run directory for the same time window, without requiring a monitoring stack. Suggested: `tools/attach-metrics.js <run> <file.json|csv>` storing the file and recording it in `result.json`, and, for the mock, a sampler of `/__admin/stats` as the worked example. `run.startedAt` and `run.endedAt` give the window. Keep it small.
  - CI: `.github/workflows/` with a PR job (install, `npm run check`, start mock, smoke) and a scheduled job (baseline compare). Decide what the scheduled job compares against: in CI the only target is the mock, so the honest design is to run the profile twice or keep a committed mock baseline at a fixed time scale, and document that real projects point the job at their own environment and baseline. Validate workflow YAML syntax locally (no `actionlint` installed; check with `which actionlint`, otherwise parse the YAML with Python or Node and verify by running the job's commands locally end to end).
- Capacity interface: `node tools/capacity.js <run|latest> [--peak] [--headroom] [--growth] [--instances] [--redundancy]` writes `capacity-report.md`, `capacity.svg`, `capacity.json` into the run directory; exit 0 knee found, 1 no knee, 2 could not analyse. Defaults in `config/capacity.json` (headroom 0.3, minEfficiency 0.95, growth 1.5, redundancy 1, instances tested 1).
- Observed generator cost of the capacity profile: 28 scenarios pre-allocate VUs separately, peaking at about 770 MB and a brief 300% CPU spike at start on this laptop. Fine here; worth a troubleshooting note in the docs (many scenarios times large VU pools costs memory).
- To render an SVG for inspection on macOS: `qlmanage -t -s 1440 -o <scratchpad> <file.svg>`, then read the PNG. Copy the SVG to a new name first, since thumbnails for the same name can be stale.
- Do not write temporary files to `/tmp`, and do not `rm` with a shell-variable path (blocked by a safety check); use literal paths.
- Compare interface: `node tools/baseline.js save <run|latest>`, `node tools/compare.js <run|latest> [--baseline f] [--tolerances f]`; exit 0 no regression, 1 regression, 2 not comparable. Baselines live at `baselines/<service>/<environment>/<profile>.json`. No baseline is committed yet.
- Results layout: `results/<UTC yyyymmdd-hhmmss>_<service>_<profile>/` with `result.json` (schema v1, see `tools/lib/result.js`: `run`, `verdict`, `gate`, `aborted`, `validity`, `sloBreaches`, `steadySeconds`, `transactions`, `windows`, `checks`), `k6-summary.json` (raw, minus setup data) and `generator-samples.json`.
- Verdicts and wrapper exit codes: pass 0, fail 99, invalid 3, error (k6's own code), did not start 2. Invalid outranks fail. Exploratory profiles (`gate: false`) pass even when aborted by an abort threshold; windows that did not complete are marked `complete: false` and excluded.
- k6 summary formats: on 1.6.1 the legacy object honours `summaryTrendStats` (p99, count); the machine-readable object on 1.6.1 has only avg/min/med/max/p90/p95 and no threshold results, so the harness does not pass `--new-machine-readable-summary`, derives counts from the `transaction_failed` rate metric (works in both formats) and takes the gate verdict from k6's exit code plus its own SLO evaluation. `tools/lib/summary.js` accepts either shape. If k6 2.x omits p99 from trends, p99 SLOs are still enforced by k6 thresholds but show as "-" in the report; note this in the compatibility docs.
- When capturing run output to a log, print only from the report onwards: `sed -n '/^Run 2/,$p' file`. k6's progress output is thousands of lines.
- Current run interface: `node tools/run.js <profile> [--env] [--service] [--time-scale] [--vus] [--allow-production]`. `.env` is loaded if present.
- Adding a service: `config/services/<name>/{workload,slo}.json` plus data, `src/services/<name>.ts` exporting a factory, registered in `src/services/index.ts`.
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
