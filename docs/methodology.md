# Methodology

This explains how the harness measures and why it is built that way. Each section ends with where the behaviour lives in the repository, so you can check the claim against the code.

## The workload model is data

A test is only as meaningful as the workload it applies. The workload model for a service is a file, `config/services/<name>/workload.json`:

```json
{
  "service": "example",
  "version": "1",
  "peakRate": 100,
  "maxIterationSeconds": 1,
  "requestTimeout": "5s",
  "transactions": [
    { "name": "list_items", "weight": 50 },
    { "name": "read_item", "weight": 35 },
    { "name": "create_item", "weight": 10 },
    { "name": "login", "weight": 5 }
  ]
}
```

- **A transaction** is a named unit of user-visible work, the thing an SLO is written for. It can be one request or several.
- **One iteration runs one transaction**, chosen at random by weight. The arrival rate is therefore in transactions per second, which is also the unit capacity is stated in.
- **`peakRate`** is transactions per second at production peak. Profiles are multiples of it, so the same profile applies to any service.

Profiles scale the model; they never redefine the mix. Changing the mix changes the model's hash, and the compare tool refuses to compare runs with different hashes.

### Deriving the model from production traffic

1. Take request logs or metrics for the busiest hour of a representative busy day (not an incident, not an average day).
2. Group requests into transactions by route template, not by URL: `GET /items/:id`, not `GET /items/8231`.
3. For each transaction, count requests in that hour. The weights are those counts (any common scale works; only the ratios matter).
4. `peakRate` is the total across transactions divided by 3600, taken from the busiest hour. If traffic is bursty within the hour, use the busiest five minutes instead and say so in the test plan.
5. Leave out what you do not intend to test (health checks, static assets served by a CDN), and write down that you left it out.
6. Check payloads and data: if 5% of real reads fetch very large objects, a workload of uniformly small reads will overstate capacity. Model that as a separate transaction with its own weight.
7. Bump `version` whenever the model changes, and record where the numbers came from.

_Code: `src/lib/workload.js`, `config/services/example/workload.json`._

## Open model by default

k6 can generate load two ways:

- **Closed model** (VU-based executors): a fixed number of virtual users each wait for a response before sending the next request. When the system slows down, the users slow down with it, so the offered load falls exactly when the system is struggling. Latency measured this way under-reports the problem; this is known as coordinated omission.
- **Open model** (arrival-rate executors): new iterations start at a set rate regardless of how the system responds, which is how independent users on the internet behave.

Every bundled profile uses arrival-rate executors. Use a closed model only when concurrency itself is what you are modelling (a fixed pool of batch workers, a known number of connected sessions). A think-time helper for that case is in `src/lib/pacing.ts`; calling it in an arrival-rate scenario would only tie up VUs.

_Code: `src/lib/plan.js`._

## A run must prove its own validity

With arrival-rate executors, k6 keeps running when it cannot reach the target rate: it counts the iterations it could not start as `dropped_iterations` and carries on. The latency of the iterations that did run can look perfectly healthy while only a fraction of the intended load was applied. A run like that says nothing about the system.

The harness therefore gives each run one of four verdicts: `pass`, `fail`, `invalid` or `error`. A run is **invalid**, which outranks pass and fail, when any of these hold:

- k6 dropped more than 1% of the planned iterations;
- a completed steady-state window ran fewer than 98% of its planned iterations;
- the k6 process used more than 80% of all CPU cores for three consecutive one-second samples, or more than 90% of host memory.

An invalid run exits with code 3 and prints the reasons. Fix the cause (usually VU allocation or generator size; see [troubleshooting](troubleshooting.md)) and rerun.

_Code: `tools/lib/result.js`, `tools/lib/generator.js`, `src/lib/thresholds.js`._

## SLOs as code

SLOs are declared per service in `config/services/<name>/slo.json`:

```json
{
  "default": { "p95": 250, "p99": 400, "errorRate": 0.01 },
  "transactions": { "create_item": { "p95": 300, "p99": 500 } }
}
```

`pNN` values are milliseconds; `errorRate` is a share between 0 and 1. Per-transaction entries override the defaults. These are compiled into k6 thresholds, so k6 itself fails the run when one is breached.

Three choices are worth knowing about:

- **Percentiles, never averages.** An average hides the slow tail that users notice.
- **Transaction metrics, not `http_req_*`.** The harness records `transaction_duration` and `transaction_failed` around each transaction. A transaction fails on a transport error, an unexpected status, or a failed content check, so a `200` with the wrong body counts as a failure.
- **Latency covers successful transactions only.** A service that rejects requests in 2 ms would otherwise look faster the more it fails. Failures are counted by the error rate instead. Always read the two together.

_Code: `src/lib/thresholds.js`, `src/lib/runner.ts`, `src/lib/http.ts`._

## Steady state is measured separately from ramps

A ramp is a transition, not a measurement. Numbers averaged across a ramp and a hold describe neither.

k6's end-of-test summary cannot be windowed by time, so the harness turns every stage of a profile into its own k6 scenario, tagged `phase: ramp` or `phase: steady`. SLO thresholds apply to `phase: steady` only, and every window is reported separately with its target rate and what was actually achieved. The stair-step capacity profile is the same mechanism: each step is a short transition followed by a hold that is measured on its own.

A window counts only if the run lasted until its end. When an abort threshold stops an exploratory run early, later windows are marked incomplete and excluded.

_Code: `src/lib/plan.js`, `tools/lib/result.js`._

## The profiles

| Profile        | Question it answers                                                   | How to read the result                                               |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `smoke`        | Do the scripts, data and environment work?                            | Must pass before anything else is worth running.                     |
| `average-load` | Does the system meet its SLOs at peak-hour load?                      | The baseline. Compare every later run against it.                    |
| `stress`       | How does it behave above expected peak?                               | Look at how it degrades: gradually, or by falling over.              |
| `spike`        | Does it survive a sudden burst and recover afterwards?                | Compare the last window (after the spike) with the first (before).   |
| `soak`         | Does anything leak or degrade over hours?                             | Passing SLOs is not enough; check server-side memory, handles, disk. |
| `breakpoint`   | Roughly where is the ceiling?                                         | Quick and coarse. The abort thresholds end the run.                  |
| `capacity`     | What load can it sustain within its limits, and how much is headroom? | Feed it to `tools/capacity.js`.                                      |

Gating profiles (smoke, average-load, soak) fail on an SLO breach. Exploratory profiles (stress, spike, breakpoint, capacity) are expected to breach SLOs, so they record them without failing and carry abort thresholds, with a delay so that early noise does not end the run.

_Code: `config/profiles.json`._

## Results carry their provenance

Every `result.json` records what produced it: run ID and timestamps, service, profile, environment name, time scale, workload version and hash, SLO and profile hashes, git commit and whether the tree was dirty, k6 version, and the generator platform. The environment's URL is deliberately not recorded, so results can be shared without leaking hostnames.

The document has its own schema version and is built from k6's summary by code in this repository, so the analysis tools do not depend on k6's summary format.

_Code: `tools/run.js`, `tools/lib/result.js`, `tools/lib/summary.js`._

## Regression detection

`tools/compare.js` compares a run with a baseline, transaction by transaction.

- **Latency** (median, p95, p99 by default) regresses only when it is worse by more than a relative tolerance **and** by more than an absolute floor. With the defaults, 10% and 5 ms: a change from 20 ms to 24 ms is +20% but is noise; 50 ms to 73 ms is a regression.
- **Error rate** regresses when the failed share rises by more than 0.5 percentage points.
- **Throughput** is judged on the total across transactions, with a 5% tolerance. It is not judged per transaction, because each iteration picks its transaction at random and one transaction's share varies by several percent between identical runs.

The tool refuses to compare runs that differ in service, profile, profile definition, environment, workload model or time scale, and refuses runs whose verdict is invalid or error. Only a passing run can be saved as a baseline.

### Noise

A single run is one sample. Before trusting a comparison:

1. Run the baseline profile several times against an unchanged system and compare each run with the first. If any is flagged, your tolerances are tighter than your environment's noise.
2. Set the tolerances in `config/compare.json` just above the noise you observed. The shipped values are starting points, not calibrated ones.
3. When a regression is flagged, rerun before investigating. A real regression reproduces.
4. Keep the environment constant between baseline and comparison: same instance sizes, same data volume, same time-of-day effects if the environment is shared.

_Code: `tools/lib/compare.js`, `config/compare.json`._

## Capacity analysis

`tools/capacity.js` analyses a run of the stair-step `capacity` profile.

**Load levels.** Each completed steady window is one level: offered rate, successful throughput, failed share, latency, and the mean number of transactions in the system from Little's law (throughput × mean latency).

**The knee.** A level is within limits when p95 and p99 are below the service's default SLO, the failed share is below the SLO error rate, and successful throughput is at least 95% of offered load. The knee is the last level within limits before the first that is not. A level that looks healthy again after the system has tipped over does not move it. The knee is accurate only to the step size: the true limit lies between the knee and the next level, so use smaller steps around the knee if you need a tighter figure.

**The ceiling** is the highest successful throughput at any level. It is a limit, not an operating target: at the ceiling the system is already failing or queueing.

**Universal Scalability Law.** The tool fits `X(N) = λN / (1 + σ(N−1) + κN(N−1))`, where N is the number of transactions in the system, σ is contention (work queueing for a shared resource) and κ is coherency (the cost of coordination, which makes throughput fall past a peak). It reports the coefficients, R², the worst miss against measurement, and the predicted maximum. USL describes gradual loss of scalability. A system that scales linearly and then hits a hard limit, such as a fixed worker pool or a rate limiter, is not well described by it; the bundled mock is such a system. When the fit is poor the report says so and tells you to use the measured knee.

**Headroom and sizing.**

- Safe operating capacity = knee × (1 − headroom). Default headroom is 30%. Headroom covers what the test did not: traffic above forecast, a different mix, a failed instance, a noisy neighbour.
- Instances for load = ⌈ forecast peak × growth ÷ safe capacity per instance ⌉, plus redundancy (N+1 by default).

Sizing is stated only when a knee was found. If every level was within limits, the report says the knee was not reached and that capacity is at least the highest level tested.

### What the analysis does not tell you

- **Which resource is the limit.** The load test shows where the system stops keeping up, not why. Before acting on a sizing, confirm the limiting resource from server-side metrics for the same window: for each resource (CPU, memory, connection pools, disk, downstream services), look at utilisation, saturation (queueing) and errors. The `serverStatsUrl` hook stores such metrics next to the run; see [onboarding](onboarding-a-service.md#server-side-metrics).
- **Whether scaling out works.** Sizing assumes capacity grows linearly with instance count. That stops when a shared dependency such as the database becomes the bottleneck. Test at two instance counts before relying on it.
- **Anything about a different workload.** The result holds for the mix, data volume and environment tested.

_Code: `tools/lib/capacity.js`, `tools/lib/capacity-analysis.js`, `config/capacity.json`._

## How the harness itself is checked

The bundled mock service has a fixed worker pool with timer-based service times, so its maximum throughput is known by construction: workers ÷ mean service time, 210.5 transactions/s for the example mix. Unit tests check the fitting and knee logic against synthetic data with known answers, and running the capacity profile against the mock finds the knee within the step size of the designed capacity; halving the mock's workers halves the detected knee.
