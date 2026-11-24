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
- **Tooling** (iteration 2): one `tsconfig.json` type-checks `src`, `tools`, `mock`, `test` with both k6 and Node types; ESLint flat config gives `src/` only k6 globals and the rest Node globals. Dev dependencies: typescript, @types/k6, @types/node, eslint, @eslint/js, typescript-eslint, globals, prettier.
- **Mock capacity** will be `workers / serviceTime`; default sized well under what a laptop can generate so the generator is never the bottleneck.

## Verification log

- Iteration 1 (bootstrap): environment commands run and recorded above. No milestone checks yet.
- Iteration 2 (milestone 1): `npm run typecheck` exit 0, `npm run lint` exit 0, `npm run format:check` exit 0, `npm test` 2 passed / 0 failed. Probe in scratchpad: k6 1.6.1 ran a `.ts` entry script importing both a relative `.js` module and a `.ts` module (output `double=42 helper=ok`).

## Notes for the next iteration

- Start milestone 2 (mock service). Size it so capacity = workers / service time, default around 200 req/s, so a laptop generator is never the bottleneck.
- Confirmed on k6 1.6.1: `.ts` scripts import relative `.js` and `.ts` modules (extensions required in the import path). So shared pure logic lives in `src/lib/*.js` with JSDoc types, checked by `tsc` (`checkJs`) and tested by `node:test`; k6-specific code is `.ts`.
- Confirmed on k6 1.6.1: `k6 run` has `--summary-mode compact|full|disabled`, `--new-machine-readable-summary` and `--summary-export`. Without the new flag, `handleSummary` receives the legacy shape (`root_group, options, state, metrics, setup_data`). In milestone 5, enable the new machine-readable summary explicitly (it is the default in 2.x) and normalise from that, so one code path serves both versions; verify the shape by dumping it first.
- Prettier formats Markdown too, so run `npm run format` before committing docs.

## Open questions for the user

None blocking. Defaults assumed: HTTP/REST targets, GitHub Actions, no Docker.

## Future work

(empty)
