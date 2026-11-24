# Performance test plan: <service>

Copy this file, fill it in, and get it agreed before running anything beyond smoke.

| Field        | Value |
| ------------ | ----- |
| Service      |       |
| Author       |       |
| Date         |       |
| Reviewers    |       |
| Plan version |       |

## 1. Purpose

What decision will this test inform? State it as a question the results can answer, for example "Can the service meet its SLOs at the forecast peak for the next two quarters on the current instance count?"

## 2. Scope

- **In scope:** transactions and components under test.
- **Out of scope:** what is deliberately not tested, and why (third-party services, CDN-served content, batch jobs).
- **Stubs and dependencies:** which dependencies are real and which are stubbed. A stubbed dependency cannot be the bottleneck, so say what that hides.

## 3. Environment

| Item                                     | Value |
| ---------------------------------------- | ----- |
| Environment name (`config/environments`) |       |
| Instances, sizes, autoscaling settings   |       |
| Data volume compared with production     |       |
| Differences from production              |       |
| Load generator (size, location)          |       |
| Shared with other teams or tenants?      |       |

## 4. Authorisation and safety

- Who approved load on this environment, and when:
- Agreed test window:
- Who is watching the system during the test, and how they reach the tester:
- Stop conditions (in addition to the profile's abort thresholds):
- Impact on other users of the environment, and who was told:
- Clean-up of data the test creates:

## 5. Workload model

- Source of the numbers (system, date range, peak hour chosen):
- Workload model file and version:

| Transaction | Weight | Share | Notes on payload or data |
| ----------- | -----: | ----: | ------------------------ |
|             |        |       |                          |

- Peak rate (transactions/s) and how it was derived:
- Known gaps between this model and production traffic:

## 6. SLOs and pass criteria

| Transaction | p95 (ms) | p99 (ms) | Error rate | Source of the target |
| ----------- | -------: | -------: | ---------: | -------------------- |
| default     |          |          |            |                      |

- Regression tolerances (`config/compare.json`) and the measured run-to-run noise they are based on:

## 7. Tests to run

| Profile      | Run? | Duration | Purpose in this plan | Number of repeats |
| ------------ | :--: | -------- | -------------------- | ----------------: |
| smoke        |      |          |                      |                   |
| average-load |      |          |                      |                   |
| stress       |      |          |                      |                   |
| spike        |      |          |                      |                   |
| soak         |      |          |                      |                   |
| breakpoint   |      |          |                      |                   |
| capacity     |      |          |                      |                   |

Changes to the default profiles in `config/profiles.json`, if any:

## 8. Test data

- Test accounts (how many, how provisioned; no credentials in this document):
- Reference data and its volume:
- Data created by the test and how it is removed:

## 9. Monitoring

- Server-side metrics to capture for each run (per resource: utilisation, saturation, errors):
- Dashboards and their owners:
- `serverStatsUrl` or OpenTelemetry export configured? Where do the metrics go?

## 10. Risks and assumptions

| Risk or assumption | Effect on the result if wrong | Mitigation |
| ------------------ | ----------------------------- | ---------- |
|                    |                               |            |

## 11. Deliverables

- Results directories and where they are archived:
- Baseline to be committed:
- Capacity report (see `capacity-report.md` template):
- Who receives the conclusions, and by when:
