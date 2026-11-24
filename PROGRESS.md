# Progress

Working memory for the build loop defined in `LOOP_PROMPT.md`. Read this first in every iteration.

## Environment (recorded 2026-11-24, iteration 1)

| Item | Value |
| --- | --- |
| k6 | v1.6.1 (go1.26.0, darwin/arm64), installed at `/opt/homebrew/bin/k6` |
| Node | v20.20.2 |
| npm | 10.8.2 |
| OS | macOS 14.6.1 (23G93), arm64 |
| git | 2.47.0 |
| Docker | not installed |

k6 compatibility target: write against 1.6.1 and avoid everything removed in 2.x (`externally-controlled` executor, `--no-summary`, legacy summary mode, `options.ext.loadimpact`). Do not use the built-in Prometheus remote-write or InfluxDB outputs (deprecated in later 2.x); use OpenTelemetry. Never parse the console summary; results come from `handleSummary` only, normalised into the harness's own schema.

## Milestones

Status values: `todo`, `in progress`, `done`. A milestone is `done` only when its check was run and passed, with the command and result recorded under "Verification log".

- [ ] **1. Skeleton and conventions** (todo). Layout, `package.json`, TypeScript config with k6 types, lint and format, `.env.example`, `.gitignore`. Check: type-check and lint pass.
- [ ] **2. Mock service with a known capacity** (todo). Dependency-free Node HTTP service (login, list, read, write), fixed worker pool and bounded queue, configurable. Check: starts, responds, and a quick overload shows 503s or latency growth near the designed limit.
- [ ] **3. Core library** (todo). Environment and allowlist guard, workload model loader, SLO-to-threshold compiler, tagged HTTP client with checks, auth helper, `SharedArray` test data, think time, custom metrics. Check: unit tests pass, including the guard refusing a non-allowlisted host.
- [ ] **4. Profiles and entry script** (todo). Smoke, average-load, stress, spike, soak, breakpoint, stair-step capacity; one run wrapper. Check: smoke and a shortened average-load run pass against the mock with thresholds green.
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
- **Mock capacity** will be `workers / serviceTime`; default sized well under what a laptop can generate so the generator is never the bottleneck.

## Verification log

- Iteration 1 (bootstrap): environment commands run and recorded above. No milestone checks yet.

## Notes for the next iteration

- Start milestone 1. Node 20 does not run TypeScript directly, so either keep shared pure logic in `.js` with JSDoc types (importable by both k6 and Node) or add a build step; prefer the former to keep dependencies minimal. Confirm that k6 1.6.1 can import a relative `.js` module from a `.ts` script before committing to this.
- Confirm on 1.6.1 which summary flags exist (`k6 run --help`: `--summary-mode`, `--new-machine-readable-summary`) before designing the results pipeline.

## Open questions for the user

None blocking. Defaults assumed: HTTP/REST targets, GitHub Actions, no Docker.

## Future work

(empty)
