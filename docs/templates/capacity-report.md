# Capacity report: <service>

This is the document for decision-makers. `tools/capacity.js` generates the measurements (`capacity-report.md` in the run directory); this template adds what the tool cannot know: the bottleneck, the context, and the recommendation. Attach or link the generated report and chart.

| Field                  | Value |
| ---------------------- | ----- |
| Service                |       |
| Author                 |       |
| Date                   |       |
| Test plan              |       |
| Run ID(s)              |       |
| Environment            |       |
| Workload model version |       |

## 1. Conclusion

Two or three sentences a reader can act on without reading further: the safe operating capacity, how that compares with current and forecast peak demand, and the recommendation.

## 2. Key figures

| Figure                                    | Value | Source                                 |
| ----------------------------------------- | ----: | -------------------------------------- |
| Knee (highest load within limits)         |       | generated report                       |
| Ceiling (maximum successful throughput)   |       | generated report                       |
| Headroom applied                          |       | `config/capacity.json` or `--headroom` |
| Safe operating capacity                   |       | generated report                       |
| Current peak demand                       |       | production metrics, date range         |
| Utilisation of the knee at current peak   |       | generated report                       |
| Forecast peak (growth factor, horizon)    |       | planning input, and who supplied it    |
| Instances tested                          |       | environment                            |
| Instances recommended (load + redundancy) |       | generated report                       |

The ceiling is a limit, not an operating target. Operate at or below the safe operating capacity.

## 3. Evidence

- Chart of throughput and p95 latency against offered load (from the run directory).
- Load levels table (from the generated report).
- Number of runs this conclusion rests on, and how much the knee varied between them:
- Was any run time-scaled? (If so, it is a rehearsal and must not be the basis of this report.)

## 4. Limiting resource

What saturated at the knee, and the evidence for it. For each candidate resource, record utilisation, saturation (queueing) and errors at the last level within limits and the first level beyond it.

| Resource                   | At the knee | Beyond the knee | Verdict |
| -------------------------- | ----------- | --------------- | ------- |
| Application CPU            |             |                 |         |
| Application memory / GC    |             |                 |         |
| Thread or connection pools |             |                 |         |
| Database (CPU, locks, IO)  |             |                 |         |
| Downstream services        |             |                 |         |
| Network / load balancer    |             |                 |         |

If the limiting resource was not identified, say so. An instance count without a known bottleneck is a guess: adding instances does not help when the limit is a shared dependency.

## 5. Scalability

- USL coefficients and fit quality from the generated report, and whether the model is a fair description of this system:
- Does capacity scale with instance count? Evidence (a test at a second instance count), or state that it is assumed:

## 6. Assumptions and limits

- The result holds for the tested workload mix, data volume and environment. Differences from production:
- Step size of the capacity profile, which bounds the precision of the knee:
- Dependencies that were stubbed or shared:
- Anything that happened during the test that could affect the result:

## 7. Recommendation

- Capacity action (instances, sizes, limits, autoscaling thresholds):
- Alert thresholds that follow from the safe operating capacity:
- Engineering work that would raise the limit, in order of expected value:
- When to retest (date, or the triggers: a release that changes the hot path, a change in mix, growth beyond the forecast):
