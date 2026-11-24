# Onboarding a service

This runbook takes a service from nothing to a baseline and a capacity figure. The bundled `example` service is the worked reference for every step: copy from it.

Before you start, read the test plan template ([templates/test-plan.md](templates/test-plan.md)) and agree the answers with the service's owners. In particular, get written authorisation for the environment you will load.

## 1. Describe the workload

Create `config/services/<name>/workload.json`. Derive the numbers from production traffic as described in [methodology.md](methodology.md#deriving-the-model-from-production-traffic).

| Field                 | Meaning                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `service`             | Must equal `<name>`.                                                                                |
| `version`             | Bump whenever the model changes.                                                                    |
| `peakRate`            | Transactions per second at production peak. Profiles are multiples of this.                         |
| `transactions`        | Name (snake_case) and weight of each transaction. Only the ratios of the weights matter.            |
| `maxIterationSeconds` | Longest time one iteration may take under overload. Used to size VUs: rate × this value.            |
| `requestTimeout`      | Per-request timeout, as a k6 duration. Also the grace period for in-flight requests at window ends. |
| `thinkTime`           | Optional; only used by closed-model scenarios you write yourself.                                   |
| `data`                | Optional map of data file names, relative to the service's config directory.                        |

Set `maxIterationSeconds` to roughly the latency you expect when the system is overloaded, not when it is healthy. Too small and the generator runs out of VUs during stress and capacity tests, which makes the run invalid.

## 2. Declare the SLOs

Create `config/services/<name>/slo.json` with a `default` block and, where needed, per-transaction overrides. Keys are `pNN` (milliseconds; decimals such as `p99.9` are allowed) and `errorRate` (0 to 1).

Use the SLOs the service is actually held to. If there are none, agree provisional ones and record that they are provisional. Do not derive them from the first test run.

## 3. Prepare test data

Put data files in `config/services/<name>/` and name them under `data` in the workload model. Rules:

- No real customer data and no secrets in these files. Usernames of dedicated test accounts are fine; their password comes from the `SUT_PASSWORD` environment variable.
- Provide enough distinct users and records that caches behave as in production. One user and one record tests the cache, not the system.
- If transactions create data, decide how it is cleaned up and write that in the test plan.

## 4. Implement the transactions

Create `src/services/<name>.ts` by copying `src/services/example.ts`, then register it in `src/services/index.ts`.

A service module exports a factory that receives the run context and an HTTP client and returns:

- `setup()`: runs once before load starts. Its return value is passed to every iteration. Log test users in here (see `loginAll` in `src/lib/auth.ts`), so that login load during the test is exactly what the model's `login` weight says.
- `transactions`: one function per transaction named in the workload model. The harness refuses to start if one is missing.

Inside a transaction, use the client:

```ts
client.get(`/orders/${id}`, {
  endpoint: 'GET /orders/:id',
  token: tokenForVu(data.tokens),
  checks: { 'returns the order': (r) => r.json('id') === id },
});
```

- `endpoint` is the metric name for the request. Use the route template, never the concrete URL, or every ID becomes its own metric series.
- `expectedStatus` defaults to 200.
- `checks` assert on content. A failed check fails the transaction, so check enough to know the response is the real thing, and no more.
- Data files can only be opened in the factory body (k6's init context), not inside a transaction. Use `loadJsonArray` from `src/lib/data.ts`.

Things `setup()` returns must be JSON-serialisable, and must not be something you would mind in memory on the generator. The harness removes them from the stored summary.

## 5. Add the environment

Add an entry to `config/environments.json`:

```json
"staging": {
  "description": "Staging; hosts come from environment variables.",
  "baseUrl": "${STAGING_BASE_URL}",
  "allowedHosts": ["${STAGING_HOST}"],
  "production": false
}
```

- Keep real hostnames out of the file with `${VAR}` placeholders, and set the variables in `.env` (git-ignored) or in your CI's secrets.
- `allowedHosts` is the safety allowlist. The run is refused unless the host of `baseUrl` is in it.
- Omitting `"production": false` marks the environment as production, which is refused without `--allow-production`.

Never load-test production without explicit, written approval, a time window, and someone watching the system who can tell you to stop.

### Server-side metrics

Optionally add `"serverStatsUrl"`: a URL that returns JSON. The harness polls it every two seconds during the run and writes each response, timestamped, to `server-stats.jsonl` in the run directory. Its host must also be in `allowedHosts`.

Point it at whatever exposes the numbers you need to identify a bottleneck: the service's own stats endpoint, or a small exporter that queries your monitoring system and returns CPU, memory, pool usage and queue depths as JSON. The harness stores the samples; interpreting them is up to you.

To stream k6's own metrics to your observability stack, start runs with `--otel` and set the `K6_OTEL_*` variables shown in `.env.example`. Every metric carries a `testid` tag equal to the run ID.

## 6. Smoke

```sh
node tools/run.js smoke --service <name> --env <env>
```

Fix everything smoke reports before going further: failed checks, authentication, data. Smoke applies 2 transactions/s for 30 seconds.

## 7. Establish the baseline

```sh
node tools/run.js average-load --service <name> --env <env>
```

This is a full run (37 minutes with the default profile). Check that the verdict is `pass` and that the load windows table shows the planned iterations were delivered. Repeat it two or three times and compare the runs with each other to learn your environment's noise (see [methodology.md](methodology.md#noise)); adjust `config/compare.json` if needed. Then save one as the baseline and commit it:

```sh
node tools/baseline.js save latest
git add baselines/ && git commit -m "Baseline for <name> on <env>"
```

From now on, after each change to the service:

```sh
node tools/run.js average-load --service <name> --env <env>
node tools/compare.js latest
```

Regenerate the baseline deliberately, and say why in the commit, when the workload model, the profile or the environment changes. The compare tool will refuse to compare across such a change.

## 8. Measure capacity

```sh
node tools/run.js capacity --service <name> --env <env>
node tools/capacity.js latest --peak <forecast peak> --growth <factor> --instances <instances tested>
```

Adjust the `capacity` profile's steps in `config/profiles.json` so that they bracket the expected limit, with several levels on each side. A quick `breakpoint` run first tells you roughly where that is. If the report says the knee was not reached, raise `to`; if it says the system was outside its limits at the lowest level, lower `from`.

While the test runs, watch the system's own dashboards. Afterwards, find the resource that saturated at the knee before acting on the instance count. Write the result up with [templates/capacity-report.md](templates/capacity-report.md).

## 9. Automate

Adapt the two workflows in `.github/workflows/`: point them at your environment, provide the hostnames and `SUT_PASSWORD` as repository secrets, and use a runner with a stable network path to the target. Run smoke on pull requests; run the baseline comparison on a schedule rather than per pull request, because it takes time and needs a quiet environment.

## Checklist

- [ ] Test plan agreed, including authorisation for the environment
- [ ] Workload model derived from production traffic, with its source recorded
- [ ] SLOs declared and agreed
- [ ] Test data prepared; no real customer data or secrets in the repository
- [ ] Transactions implemented with content checks
- [ ] Environment added with an allowlist; `production` flag set correctly
- [ ] Smoke passes
- [ ] Noise measured; compare tolerances adjusted
- [ ] Baseline saved and committed
- [ ] Capacity run analysed; limiting resource identified from server-side metrics
