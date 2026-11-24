# Troubleshooting

## The run did not start (exit code 2)

| Message                                                                | Cause and fix                                                                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Refusing to run: host "..." is not in the allowlist`                  | The host of the environment's `baseUrl` is not in its `allowedHosts`. Add it in `config/environments.json` only if you are authorised to load that host. |
| `Refusing to run: environment "..." is marked production`              | The environment lacks `"production": false`. If it really is production, you need explicit approval and `--allow-production`.                            |
| `Refusing to run: serverStatsUrl host "..." is not in the allowlist`   | The stats endpoint is on a host the environment does not list. Add the host to `allowedHosts` or remove `serverStatsUrl`.                                |
| `Environment variable X is required but not set`                       | An environment uses a `${X}` placeholder. Set it in `.env` or the shell.                                                                                 |
| `Unknown profile` / `Unknown environment` / `No workload model at ...` | Check the name against `config/profiles.json`, `config/environments.json`, `config/services/`.                                                           |
| `Could not start k6`                                                   | k6 is not installed or not on `PATH`.                                                                                                                    |

## k6 exited with an error before the report

| Symptom                                                    | Cause and fix                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SUT_PASSWORD is not set`                                  | Copy `.env.example` to `.env`, or set the variable.                                                                         |
| `Setup login failed for user "..."`                        | The target is not reachable, or the test credentials are wrong. With the mock: it is not running; use `tools/with-mock.js`. |
| `Workload "..." has unimplemented transactions`            | The workload model names a transaction that the service module does not implement.                                          |
| `Service "..." is not registered in src/services/index.ts` | Register the new service module.                                                                                            |
| `the mock service exited during start-up`                  | Port 3333 is in use. Stop the other process or set `MOCK_PORT` (and the `local` environment's URLs to match).               |

## VERDICT: INVALID (exit code 3)

An invalid run cannot be used, whatever its latency looked like. The report lists the reasons.

**`k6 dropped N iterations`** or **`only N of M planned iterations ran`**. The generator could not start iterations at the planned rate, almost always because it ran out of pre-allocated VUs: every VU was still busy with an earlier iteration. k6 logs `Insufficient VUs` when this happens.

- Each scenario pre-allocates rate × `maxIterationSeconds` VUs. If the system gets slower than `maxIterationSeconds` under load, raise that value in the workload model.
- Check you did not leave a `--vus` override on the command.
- If the system is so overloaded that requests run to the timeout, this is expected in the highest levels of a capacity test. Lower `requestTimeout`, or stop the profile at a lower level.

**`load generator CPU stayed above 80%`** or **`memory exceeded 90%`**. The generator machine is the bottleneck, and measured latency includes its own delays.

- Use a larger generator, or one closer to the target.
- Reduce work per iteration: fewer or cheaper checks, avoid parsing large bodies when a status check is enough.
- The stair-step profile creates many scenarios, each with its own VU pool. On the bundled example (28 scenarios, up to 300 VUs each) k6 peaked at about 770 MB. Fewer or shorter steps reduce that.
- Beyond one machine you need distributed execution, which this harness does not set up.

**`no steady-state window completed`**. The run ended before any hold finished. Check for an early abort or a script error.

## VERDICT: FAIL (exit code 99)

An SLO was breached. The report names each breach, for example `create_item p95 320 >= 300`. Before concluding the system regressed:

- Check the run was valid and the load windows show the planned load.
- Look at failed checks in the report: a functional failure (bad data, expired credentials) shows up as an error-rate breach.
- Rerun. One run is one sample.

## The compare tool

| Message                                        | Cause and fix                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No baseline at ...`                           | Save one from a passing run: `node tools/baseline.js save <run>`.                                                                                                          |
| `Runs are not comparable: ... differs`         | The run and the baseline differ in workload model, profile, environment or time scale. Rerun with matching settings, or regenerate the baseline if the change is intended. |
| `has verdict "invalid"`                        | Fix the cause and rerun; invalid runs are never compared.                                                                                                                  |
| A regression is flagged on an unchanged system | Tolerances are tighter than your environment's noise. Measure the noise and adjust `config/compare.json` (see [methodology.md](methodology.md#noise)).                     |

## The capacity tool

| Report says                                                 | Meaning and fix                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The knee was not reached`                                  | Every level was within limits. Raise `steps.to` in the `capacity` profile.                                                                        |
| `was already outside its limits at the lowest level tested` | Lower `steps.from`, or the system has a problem unrelated to load; run smoke.                                                                     |
| `The model does not describe this system well`              | The USL fit is poor, typical for a hard limit such as a fixed pool. Use the measured knee.                                                        |
| The ceiling is higher than the knee by a wide margin        | With short holds, queues absorb excess load for the length of the hold and the level looks served. Use longer holds; do not use time-scaled runs. |
| `Run stopped early by an abort threshold`                   | Expected once the system has clearly failed. Levels that did not complete are excluded.                                                           |

## Reading results

- **Latency improved while errors rose.** Latency counts successful transactions only. Fast rejections are failures, and they leave the remaining successes looking quick. Read latency and error rate together.
- **Per-transaction throughput differs between identical runs.** Transactions are chosen at random by weight, so each one's share varies by a few percent. Total throughput is the stable figure.
- **A time-scaled run looks fine.** `--time-scale` is for rehearsing a profile. Holds of a few seconds do not reach steady state and hide slow effects such as queue growth, garbage collection and cache expiry.
- **Results from a shared environment vary by time of day.** Other tenants are part of your measurement. Run baseline and comparison under the same conditions.

## Log output

k6 prints progress several times a second. When capturing a run to a file, read from the report onward:

```sh
node tools/run.js average-load > run.log 2>&1
sed -n '/^Run 2/,$p' run.log
```
