# k6 Performance & Capacity Engineering Harness

A reusable [k6](https://grafana.com/docs/k6/) harness for performance and capacity engineers. You describe a service's workload and SLOs as data, and the harness gives you:

- the standard load-test profiles (smoke, average-load, stress, spike, soak, breakpoint, stair-step capacity) driven from one entry script;
- a pass/fail verdict against per-transaction SLOs, measured on steady state only;
- a separate **invalid** verdict when the load generator, not the system, was the limit;
- regression detection against a stored baseline;
- capacity analysis: the knee, the ceiling, a Universal Scalability Law fit, safe operating capacity with headroom, and an instance count.

It ships with a small mock service whose capacity is known by construction, so you can try everything locally and so the capacity analysis can be checked against a known answer.

## Prerequisites

- Node.js 20.12 or later
- k6 1.x ([installation](https://grafana.com/docs/k6/latest/set-up/install-k6/)); developed and verified on k6 1.6.1

## Quick start

Everything below runs against the bundled mock service on `127.0.0.1`. All three steps together take about six minutes.

```sh
npm ci
cp .env.example .env
```

**1. Smoke test** (30 seconds). Proves the scripts, data and environment work.

```sh
node tools/with-mock.js node tools/run.js smoke
```

`tools/with-mock.js` starts the mock, runs the command, and stops the mock. The run ends with a report and `VERDICT: PASS`.

**2. Load test and regression check** (about 2 minutes). Runs the average-load profile, shortened to 5% of its real duration, and compares it with the committed baseline.

```sh
node tools/with-mock.js node tools/run.js average-load --time-scale 0.05
node tools/compare.js latest
```

The comparison prints a table per transaction and ends with `NO REGRESSION`. To see a regression, slow the mock down and repeat:

```sh
MOCK_SERVICE_MS=60 node tools/with-mock.js node tools/run.js average-load --time-scale 0.05
node tools/compare.js latest
```

**3. Capacity test** (about 2 minutes). Steps the load from 40 to 300 transactions/s and analyses where the mock stops keeping up.

```sh
node tools/with-mock.js node tools/run.js capacity --time-scale 0.04
node tools/capacity.js latest
```

This prints the knee (about 200 transactions/s; the mock is designed for 210.5) and writes `capacity-report.md` and `capacity.svg` into the run's directory under `results/`.

`--time-scale` exists so you can rehearse a profile quickly. A time-scaled run is a rehearsal, not a result: holds that short do not reach steady state.

## What a run produces

Each run writes a directory `results/<UTC timestamp>_<service>_<profile>/`:

| File                               | Content                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `result.json`                      | The harness's own result document: provenance, verdict, validity, per-transaction and per-load-window measurements. |
| `k6-summary.json`                  | k6's raw end-of-test summary, without `setup()` data (which holds auth tokens).                                     |
| `generator-samples.json`           | CPU and memory of the k6 process, sampled every second.                                                             |
| `server-stats.jsonl`               | Server-side metrics, if the environment defines `serverStatsUrl`.                                                   |
| `capacity-report.md`, `capacity.*` | Written by `tools/capacity.js`.                                                                                     |

`tools/run.js` exit codes, for CI:

| Code  | Verdict       | Meaning                                                                                 |
| ----- | ------------- | --------------------------------------------------------------------------------------- |
| 0     | pass          | SLOs met (gating profiles), or the run completed (exploratory profiles).                |
| 99    | fail          | An SLO threshold was breached.                                                          |
| 3     | invalid       | The run cannot be trusted: dropped iterations, load not delivered, generator saturated. |
| 2     | did not start | Bad arguments, unknown profile, or the target was refused by the safety guard.          |
| other | error         | k6's own exit code (script error, interrupted run).                                     |

## Profiles

Profiles live in [config/profiles.json](config/profiles.json). Rates are multiples of the workload model's `peakRate`, except smoke, which is absolute.

| Profile        | Shape                                       | Gates on SLOs | Purpose                                                     |
| -------------- | ------------------------------------------- | ------------- | ----------------------------------------------------------- |
| `smoke`        | 2/s for 30 s                                | yes           | Scripts and environment work.                               |
| `average-load` | ramp to 1.0x, hold 30 min                   | yes           | Baseline behaviour at peak-hour load; regression checks.    |
| `stress`       | ramp to 1.5x, hold 20 min                   | no            | Behaviour above expected peak.                              |
| `spike`        | 0.5x, jump to 3.0x for 2 min, back to 0.5x  | no            | Survival of, and recovery from, a sudden burst.             |
| `soak`         | 0.8x for 4 h                                | yes           | Leaks and slow degradation.                                 |
| `breakpoint`   | continuous ramp to 5.0x over 20 min         | no            | Find the ceiling quickly; abort thresholds end the run.     |
| `capacity`     | steps of 0.2x from 0.4x to 3.0x, 3 min each | no            | Steady-state measurement per load level, for `capacity.js`. |

Exploratory profiles record the same SLO metrics without failing on them, and carry abort thresholds so they stop once the system has clearly failed.

## Commands

| Command                                                       | Purpose                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `node tools/run.js <profile> [options]`                       | Run a profile. `--help` lists the options.                               |
| `node tools/baseline.js save <run>`                           | Store a passing run as the baseline for its service/environment/profile. |
| `node tools/compare.js <run> [--baseline f] [--tolerances f]` | Compare with the baseline. Exit 0 none, 1 regression, 2 not comparable.  |
| `node tools/capacity.js <run> [options]`                      | Capacity analysis of a stair-step run. Exit 0 knee found, 1 no knee.     |
| `node tools/with-mock.js <command...>`                        | Run a command with the mock service started around it.                   |
| `node mock/server.js`                                         | Start the mock service by hand.                                          |
| `npm run check`                                               | Type-check, lint, format check and unit tests.                           |

`<run>` is a run directory, a `result.json` file, or `latest`.

`run.js` options: `--env <name>`, `--service <name>`, `--time-scale <0..1>`, `--vus <n>`, `--otel`, `--allow-production`.

## Safety

The harness generates load, so it refuses to run against a target it has not been told is allowed:

- A run only starts if the host of the environment's `baseUrl` is in that environment's `allowedHosts` ([config/environments.json](config/environments.json)). The check runs in the wrapper and again inside the k6 script.
- An environment is treated as production unless it says `"production": false`. Production environments are refused without `--allow-production`.
- Real hostnames and credentials stay out of the repository: environments can use `${VAR}` placeholders, and secrets are read from environment variables (or `.env`, which is git-ignored).

Only run load tests against systems you are authorised to test.

## Using it for your own service

Follow [docs/onboarding-a-service.md](docs/onboarding-a-service.md). In short: add a workload model and SLOs under `config/services/<name>/`, implement one function per transaction in `src/services/<name>.ts`, add an environment, and run smoke.

## Documentation

- [docs/methodology.md](docs/methodology.md): how the harness measures, and why. Read this before trusting a number.
- [docs/onboarding-a-service.md](docs/onboarding-a-service.md): runbook for adding a service and an environment.
- [docs/troubleshooting.md](docs/troubleshooting.md): invalid runs, refused targets, common k6 problems.
- [docs/k6-compatibility.md](docs/k6-compatibility.md): k6 versions, what is verified and what is not.
- [docs/templates/test-plan.md](docs/templates/test-plan.md) and [docs/templates/capacity-report.md](docs/templates/capacity-report.md): templates for the documents around a test.

## Layout

```
config/        environments, profiles, compare and capacity settings, services/<name>/{workload,slo}.json
src/main.ts    the single k6 entry script
src/lib/       core library (guard, workload, plan, thresholds, HTTP client, runner)
src/services/  one module per service, registered in index.ts
mock/          mock service with a known, configurable capacity
tools/         run wrapper, baseline, compare, capacity analysis
test/          unit tests (node:test)
baselines/     committed baselines
results/       run directories (git-ignored)
.github/       CI workflows
```

## Status and known limits

- Verified on k6 1.6.1, Node 20, macOS (arm64), against the bundled mock only. It has not been run against k6 2.x; see [docs/k6-compatibility.md](docs/k6-compatibility.md).
- The CI workflows have been checked by running their commands locally. They have not been executed on GitHub Actions.
- HTTP/JSON services only. Other protocols k6 supports (gRPC, WebSocket, browser) would need their own client module.
- A single load generator. Distributed execution is not set up; the validity check tells you when one generator is not enough.
- All bundled profiles use arrival-rate (open-model) executors. A think-time helper exists for closed-model scenarios, but no bundled profile uses it.
- The regression tolerances in `config/compare.json` are starting values. Calibrate them against the run-to-run noise of your own environment.
