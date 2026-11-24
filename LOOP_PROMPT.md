# Loop prompt: build the k6 Performance & Capacity Engineering Harness

You are the lead performance test engineer building a reusable k6 harness in this directory. The people who will use it are performance and capacity engineers: they need to model a workload, run the standard family of load tests against a service, decide pass/fail against SLOs, detect regressions against a baseline, and turn step-load results into a defensible capacity number with headroom. Build the harness so that such an engineer can clone it, point it at a new service by editing configuration, and get trustworthy numbers without rewriting scripts.

This prompt is run repeatedly by `/loop`. Each run is one iteration. You will not reliably remember earlier iterations, so the repository is your memory: everything you need to continue must be in `PROGRESS.md` and the code.

## How each iteration works

1. Read `PROGRESS.md`. If it does not exist, this is the first iteration: do the bootstrap described below and stop there.
2. Pick the first unfinished milestone. Work on that one only. If it is too large for one iteration, finish a coherent slice and record exactly what remains.
3. Verify what you built by running it (see "Verification"). A milestone is finished only when its acceptance check has been run and passed in this iteration; record the command and the observed result in `PROGRESS.md`.
4. Update `PROGRESS.md`: milestone status, what was verified and how, decisions made and why, anything the next iteration needs to know, open questions for the user.
5. Commit locally with a descriptive message (`git init` on the first iteration). Never push and never add a remote.
6. If every milestone is finished and the final acceptance run passes, write the closing summary into `PROGRESS.md`, tell the user the harness is complete, and end the loop instead of scheduling another iteration. Otherwise continue to the next iteration.

If you are blocked on something only the user can decide, record the question in `PROGRESS.md` under "Open questions", pick the most conservative default, and move on to work that does not depend on it. If the same milestone fails verification in three consecutive iterations, stop the loop and report what you tried.

## Bootstrap (first iteration only)

- Record the environment in `PROGRESS.md`: output of `k6 version`, `node --version`, OS. At the time this prompt was written the machine had k6 v1.6.1, Node 20, no Docker, and the directory was empty.
- k6 has since had a 2.x major release that removed things (the `externally-controlled` executor, `--no-summary`, the legacy summary mode, `options.ext.loadimpact`) and changed the default end-of-test summary format; the built-in Prometheus remote-write and InfluxDB outputs are deprecated in later 2.x. Write the harness against the installed version, avoid everything removed in 2.x so it runs on both, and never parse k6's human-readable console summary. When unsure whether an option or API exists in the installed version, check `k6 <command> --help` or the versioned docs at `grafana.com/docs/k6/<version>/` rather than relying on memory.
- Write the milestone list below into `PROGRESS.md` as a checklist, adjusting it if the environment demands.
- Write `CLAUDE.md` with the project conventions and the commands to run tests, so later iterations and future sessions follow them.

## Safety rules for generating load

These hold in every iteration and must also be enforced by the harness itself.

- During this build, generate load only against the local mock service on `localhost`. Never run a test against any other host.
- The harness refuses to run against a host that is not in the selected environment's allowlist, and refuses any environment marked `production` unless an explicit override flag is passed. This check lives in code, with a test.
- Secrets come from environment variables only. No credentials, tokens or real hostnames in the repository; provide `.env.example`.
- Keep verification runs short (each under about two minutes) and small enough for a laptop.

## Engineering principles the harness must embody

These are the practices that separate a capacity engineering harness from a folder of scripts. Where one is not implemented, say so in the docs rather than implying it.

**Workload model as data.** The transaction mix, arrival rates, think times, and data requirements live in a declarative workload model file per service, not inside scripts. Test profiles scale that model; they do not redefine it. Document how to derive the model from production traffic (peak-hour request rate per endpoint, mix percentages, payload distribution).

**Open model by default.** Throughput-oriented tests use arrival-rate executors so that a slowing system does not reduce the offered load and hide latency (coordinated omission). Closed-model VU executors are used only where concurrency is the thing being modelled, and the docs explain the difference.

**A run must prove its own validity.** With arrival-rate executors k6 keeps going when it cannot reach the target rate, so every profile has a `dropped_iterations` threshold and the result records achieved versus target rate. Capture load-generator CPU and memory during the run. A run where the generator was saturated or the achieved rate fell materially short is marked invalid, not pass or fail.

**SLOs as code.** SLOs are declared per transaction (latency percentiles, error rate) in configuration and compiled into k6 thresholds on tagged submetrics. Percentiles, never averages, for latency. Every request carries a stable transaction name tag so URLs with IDs do not explode metric cardinality.

**The standard test types as profiles.** Smoke, average-load (baseline), stress, spike, soak, breakpoint, and a stair-step capacity profile. Breakpoint and capacity profiles use `abortOnFail` with `delayAbortEval` so they stop safely once the system has clearly failed.

**Steady state is measured separately from ramps.** Results for a load level exclude ramp-up. For the stair-step profile, make each step separately measurable (for example, one scenario per step with its own tag and `startTime`, so each step yields its own submetrics in the summary).

**Machine-readable results with provenance.** Every run writes a directory containing a JSON result produced via `handleSummary`, plus metadata: timestamp, git commit, k6 version, profile, environment, workload model hash, target and achieved rates, validity verdict. Normalise k6's summary into the harness's own versioned schema so the analysis tools do not depend on k6's summary format.

**Regression detection against a baseline.** A compare tool takes a run and a stored baseline, and reports per-transaction deltas for latency percentiles, error rate and throughput with configurable tolerances, exiting non-zero on regression. It refuses to compare runs with different workload models or profiles. Document how to account for run-to-run noise (repeat runs, tolerance bands) rather than treating a single run as truth.

**Capacity analysis.** From a stair-step run, a tool produces: the throughput and latency curve against offered load; the knee (where latency SLO is first breached or throughput stops scaling proportionally); the saturation point; a Universal Scalability Law fit (contention and coherency coefficients, predicted peak) using concurrency derived from measurements; and the safe operating capacity as knee minus a configurable headroom. A sizing calculation then turns forecast peak demand, growth and redundancy (N+1) into required instance count. The report states its assumptions and that the ceiling is a limit, not an operating target.

**Server-side correlation is pluggable.** Capacity conclusions need the limiting resource identified (utilisation, saturation, errors per resource). Provide the hook and documentation for exporting k6 metrics via OpenTelemetry and for attaching server-side metrics to a run, without requiring any particular monitoring stack to be installed.

**Pass/fail in CI.** A workflow runs the smoke profile on pull requests and a baseline-compare run on a schedule, relying on k6's non-zero exit code on threshold failure and the compare tool's exit code. Use GitHub Actions unless `PROGRESS.md` records a different choice by the user.

## Milestones

Adjust names and layout as you see fit; keep the acceptance checks.

1. **Skeleton and conventions.** Directory layout, `package.json`, TypeScript configuration with k6 types (k6 runs TypeScript natively from 1.0), lint and format, `CLAUDE.md`, `.env.example`, `.gitignore` covering results. _Check: type-check and lint pass._
2. **Mock service with a known capacity.** A dependency-free Node HTTP service with a few realistic endpoints (login, list, read, write), a fixed worker pool and bounded queue so that its theoretical maximum throughput is known by construction, and latency that rises as it saturates. Parameters configurable so tests can change the true capacity. _Check: it starts, responds, and a quick manual overload shows 503s or latency growth near the designed limit._
3. **Core library.** Environment and allowlist guard, workload model loader, SLO-to-threshold compiler, tagged HTTP client wrapper with checks, auth helper, test-data handling with `SharedArray`, think-time helpers, custom metrics. _Check: unit tests for the pure logic pass, including the guard refusing a non-allowlisted host._
4. **Profiles and the entry script.** All seven profiles, selected by one parameter, driving the example workload model against the mock. A single run command wrapper. _Check: smoke and a shortened average-load run pass against the mock with thresholds green._
5. **Results pipeline.** `handleSummary`, normalised result schema, run directory with metadata, validity verdict including dropped iterations and generator resource capture. _Check: a run produces a schema-valid result; a deliberately under-provisioned run (too few pre-allocated VUs) is marked invalid._
6. **Baseline and regression compare.** Save-baseline and compare commands. _Check: comparing a run to itself passes; after slowing the mock, the compare exits non-zero and names the regressed transactions._
7. **Capacity analysis.** Stair-step profile, knee detection, USL fit, headroom and sizing, Markdown report with a chart. _Check: run the stair-step against the mock and confirm the detected knee is within 15% of the mock's designed capacity; change the mock's capacity and confirm the detected knee moves accordingly. Unit-test the fitting code against synthetic data with known coefficients._
8. **Observability hooks and CI.** OpenTelemetry output configuration, server-metrics attachment hook, CI workflows. _Check: workflow files are syntactically valid; the smoke job's commands run locally end to end._
9. **Documentation for the engineer.** README (quick start in under ten minutes), a methodology guide covering the principles above, a runbook for onboarding a new service, a test plan template, a capacity report template, a troubleshooting section, and the k6 version compatibility notes. Written for a performance engineer who has not seen this repository. _Check: follow the quick start verbatim from a clean clone into a temporary directory and confirm every command works._
10. **Final acceptance.** From a clean clone: install, unit tests, smoke, baseline save and compare, stair-step and capacity report, all passing. Review the whole repository once for dead code, inconsistent naming, and claims in the docs that the code does not back up, and fix what you find.

## Verification

Run things; do not reason about whether they would work. Start the mock service in the background for the checks that need it and stop it afterwards. Report results honestly in `PROGRESS.md`: if a check failed or was skipped, say so with the output. Do not weaken a threshold, tolerance or acceptance check to make it pass; if a check is wrong, record why and what you replaced it with.

## Quality bar

Professional, maintainable, and no larger than it needs to be. Prefer a small number of well-named modules over many thin ones. No dependencies beyond what is needed for types, lint and tests; the analysis tools run on plain Node. Comments explain why, not what. Do not add features outside this brief; note ideas under "Future work" in `PROGRESS.md` instead.
