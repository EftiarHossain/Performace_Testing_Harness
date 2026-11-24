# k6 compatibility

## What has been verified

| Component | Version                          | Status                                                                 |
| --------- | -------------------------------- | ---------------------------------------------------------------------- |
| k6        | 1.6.1                            | Developed and verified. Every claim in the documentation was run here. |
| k6        | 2.x                              | Written to be compatible; **not run**. See below.                      |
| Node.js   | 20.20                            | Verified. 20.12 is the minimum (`process.loadEnvFile`).                |
| OS        | macOS 14, arm64                  | Verified.                                                              |
| OS        | Linux                            | Expected to work (generator sampling uses `ps`); not run.              |
| CI        | GitHub Actions (`ubuntu-latest`) | Workflow commands verified locally; the workflows themselves not run.  |

## k6 features the harness relies on

- TypeScript entry scripts run natively (k6 1.0 and later), importing both `.ts` and `.js` modules with explicit file extensions.
- Arrival-rate executors (`constant-arrival-rate`, `ramping-arrival-rate`), scenario `startTime` and scenario tags.
- Thresholds on tagged submetrics, with `abortOnFail` and `delayAbortEval`.
- `handleSummary()`, `k6/execution` (VU-level tags), `SharedArray`, `http.expectedStatuses`.
- The `opentelemetry` output (only with `--otel`).
- Exit code 99 when thresholds fail.

## Deliberately avoided, because k6 2.x removed or deprecated them

| Avoided                                                   | Status in 2.x                           | What the harness does instead                                 |
| --------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `externally-controlled` executor, `k6 pause/resume/scale` | Removed                                 | Fixed, planned scenarios only.                                |
| `--no-summary`, the legacy console summary mode           | Removed                                 | Never parses console output; replaces it via `handleSummary`. |
| `options.ext.loadimpact`                                  | Replaced by `options.cloud`             | No cloud options are set.                                     |
| Built-in Prometheus remote-write and InfluxDB outputs     | Deprecated ahead of v3                  | OpenTelemetry output.                                         |
| `K6_OTEL_EXPORTER_TYPE`                                   | Replaced by `K6_OTEL_EXPORTER_PROTOCOL` | Documentation and `.env.example` use the new variable.        |
| Reliance on the REST API server                           | No longer started by default            | Not used.                                                     |

## The end-of-test summary format

This is the one area where 1.x and 2.x are known to differ in a way that matters.

k6 passes `handleSummary()` an object describing the run. In 1.x it has the "legacy" shape by default; a different "machine-readable" shape is available with `--new-machine-readable-summary` and is documented as becoming the default in 2.x.

- The harness reads either shape (`tools/lib/summary.js`) and converts it to its own result schema. Nothing else depends on k6's format.
- On 1.6.1 the harness uses the legacy shape, because the machine-readable shape on 1.6.1 reports only avg, min, med, max, p90 and p95 for trends: no p99 and no other percentile from `summaryTrendStats`.
- The machine-readable path is unit-tested against the shape 1.6.1 emits. It has not been exercised with a real 2.x binary.

What to expect on 2.x, and what to check first:

1. Run `npm test` and the smoke profile. If the summary reader reports an unrecognised format, the shape changed again; update `tools/lib/summary.js`, which is the only place that needs to know.
2. If 2.x trends lack p99, the report and `result.json` show `-` for p99 and the compare tool skips it. p99 SLOs are still enforced, because k6 evaluates the thresholds itself and the harness takes pass/fail from k6's exit code as well as from its own evaluation.
3. Transaction counts and error rates do not depend on trend statistics (they come from the `transaction_failed` rate metric), so validity checks and throughput are unaffected.

## Other notes

- **Usage reporting.** k6 sends anonymous usage statistics by default. The harness passes `--no-usage-report` on every run.
- **OpenTelemetry.** Verified with `K6_OTEL_EXPORTER_PROTOCOL=http/protobuf` against a local receiver. gRPC export uses the same k6 output and is not separately tested here.
- **`testid` tag.** Every run passes `--tag testid=<run id>`, so exported metrics can be matched to a result directory.
- **Pinning.** CI pins k6 to 1.6.1. Upgrade deliberately: change the pin, run the checks above, and regenerate baselines, since a new k6 version is a change to the measuring instrument.
