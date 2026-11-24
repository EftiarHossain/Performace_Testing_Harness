# k6 Performance & Capacity Engineering Harness

A reusable k6 harness for performance and capacity engineers. The build brief is `LOOP_PROMPT.md`; current status, decisions and verification history are in `PROGRESS.md`. Read `PROGRESS.md` before doing any work here.

## Safety rules (always)

- Generate load only against the local mock service on `localhost` unless the user explicitly names another target in the current session.
- The harness must refuse hosts outside the selected environment's allowlist, and refuse `production` environments without the explicit override flag. Do not weaken this guard.
- Secrets come from environment variables only. Never commit credentials, tokens or real hostnames.
- Keep verification runs under about two minutes and laptop-sized.
- Commit locally only. Never push and never add a remote.

## Layout

```
config/        environments (allowlists), workload models, SLOs, profiles
src/           k6 test code (TypeScript, run natively by k6)
  lib/         core library; pure logic has no k6 imports so Node can test it
  profiles/    smoke, average-load, stress, spike, soak, breakpoint, capacity
  main.ts      single entry script, profile selected by parameter
mock/          dependency-free Node service with a known, configurable capacity
tools/         plain Node ESM: run wrapper, results normalise, compare, capacity
test/          node:test unit tests
results/       run directories (git-ignored)
baselines/     stored baselines
docs/          methodology, runbook, templates
.github/       CI workflows (PR smoke, scheduled regression compare)
```

## Conventions

- Target k6 1.6.1 and stay compatible with 2.x: no `externally-controlled` executor, no `--no-summary`, no legacy summary mode, no `options.ext.loadimpact`, no built-in Prometheus remote-write or InfluxDB outputs.
- Never parse k6 console output. Results come from `handleSummary`, normalised into the harness's own versioned schema.
- Open-model (arrival-rate) executors by default; every profile has a `dropped_iterations` threshold.
- Latency is judged on percentiles, never averages. Every request carries a stable `transaction` tag.
- Workload models, SLOs and environments are data in `config/`; scripts do not hard-code them.
- No dependencies beyond types, lint and tests. Tools run on plain Node 20.
- Comments explain why, not what.
- Do not weaken a threshold, tolerance or acceptance check to make it pass.

## Commands

Only commands listed here are known to work; add to this list as milestones land.

- `npm install`: install dev tooling (types, lint, format).
- `npm run check`: type-check, lint, format check and unit tests. Run before every commit.
- `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`: the individual steps.
- `node mock/server.js`: start the mock system under test on `http://127.0.0.1:3333` (designed capacity 200 req/s for cost-1.0 requests; tune with `MOCK_WORKERS`, `MOCK_SERVICE_MS`, `MOCK_QUEUE_LIMIT`, `MOCK_JITTER`, `MOCK_PORT`). Stop it after use.
- `cp .env.example .env`: one-time setup; holds `SUT_PASSWORD` for the test users.
- `node tools/run.js <profile>`: run a profile (`smoke`, `average-load`, `stress`, `spike`, `soak`, `breakpoint`, `capacity`) against the `local` environment and `example` service. Needs the mock running. Options: `--env`, `--service`, `--time-scale <0..1>` (shorten stages for development), `--vus <n>`, `--allow-production`. Exit 0 pass, 99 SLO thresholds failed, 3 invalid run, 2 did not start. Each run writes `results/<UTC timestamp>_<service>_<profile>/result.json`.
- Verification-sized runs: `node tools/run.js smoke` (30 s) and `node tools/run.js average-load --time-scale 0.03` (67 s).
- Deliberately invalid run (generator starved of VUs): `node tools/run.js average-load --time-scale 0.02 --vus 1`, expected exit 3.
- When logging a run to a file, read only the report: `sed -n '/^Run 2/,$p' <log>`. k6 progress output is very long.
- `node tools/baseline.js save <run|latest>`: store a passing run as the baseline for its service, environment and profile.
- `node tools/compare.js <run|latest>`: compare with the stored baseline. Exit 0 no regression, 1 regression, 2 not comparable. To see a regression locally, restart the mock with `MOCK_SERVICE_MS=60` and rerun the same profile.
- `node tools/capacity.js <run|latest>`: capacity analysis of a stair-step run; writes `capacity-report.md`, `capacity.svg` and `capacity.json` into the run directory. Verification-sized: `node tools/run.js capacity --time-scale 0.04` (about 2 minutes), expected knee about 200/s on the default mock and about 100/s with `MOCK_WORKERS=4`.
- `node tools/with-mock.js <command...>`: run a command with the mock started and stopped around it, for example `node tools/with-mock.js node tools/run.js smoke`. This is what CI uses.
- `node tools/run.js <profile> --otel`: also stream metrics over OpenTelemetry (`K6_OTEL_*` variables, see `.env.example`).
- Regenerate the committed mock baseline after changing the workload model or the average-load profile: `node tools/with-mock.js node tools/run.js average-load --time-scale 0.05 && node tools/baseline.js save latest`.
- `k6 version`, `node --version`: environment check.

## Code placement

- Logic needed by both k6 and Node (anything pure) goes in `src/lib/*.js` with JSDoc types and no k6 imports. It is type-checked by `tsc` and unit-tested with `node:test` in `test/*.test.js`.
- Code that touches k6 APIs is TypeScript (`.ts`). Import paths always include the file extension, which k6 requires.
