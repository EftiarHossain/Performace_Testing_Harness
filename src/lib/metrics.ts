// Custom metrics the SLOs are judged on. A transaction is the unit an SLO is
// written for; it may span several HTTP requests and can fail on content even
// when every status code is 200, so the built-in http_req_* metrics are not enough.
import { Rate, Trend } from 'k6/metrics';
import { METRIC_DURATION, METRIC_FAILED } from './thresholds.js';

/** End-to-end time of successful transactions, in milliseconds. */
export const transactionDuration = new Trend(METRIC_DURATION, true);

/** Share of transactions that failed (transport error, unexpected status or failed check). */
export const transactionFailed = new Rate(METRIC_FAILED);
