// HTTP client bound to the guarded base URL. Every request carries a stable
// `name` tag (the endpoint template, not the concrete URL) and its response is
// checked; a failed check marks the surrounding transaction as failed.
import { check } from 'k6';
import http, { type RefinedResponse, type ResponseType } from 'k6/http';

export type Response = RefinedResponse<ResponseType | undefined>;

export interface RequestSpec {
  /** Endpoint template used as the metric name, e.g. "GET /items/:id". */
  endpoint: string;
  /** Status the request must return to count as successful. Default 200. */
  expectedStatus?: number;
  token?: string;
  /** Extra assertions on the response, keyed by a short description. */
  checks?: Record<string, (response: Response) => boolean>;
}

// Each VU has its own copy of module state, so this counts failures for the
// transaction the current VU is executing.
let failedChecks = 0;

export function resetFailedChecks(): void {
  failedChecks = 0;
}

export function hasFailedChecks(): boolean {
  return failedChecks > 0;
}

export interface Client {
  get(path: string, spec: RequestSpec): Response;
  post(path: string, body: unknown, spec: RequestSpec): Response;
}

export function createClient(baseUrl: string, timeout: string): Client {
  function send(method: 'GET' | 'POST', path: string, body: unknown, spec: RequestSpec): Response {
    const expectedStatus = spec.expectedStatus ?? 200;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.token) headers.Authorization = `Bearer ${spec.token}`;

    const response = http.request(
      method,
      `${baseUrl}${path}`,
      body === undefined ? null : JSON.stringify(body),
      {
        headers,
        timeout,
        tags: { name: spec.endpoint },
        // Tells k6 which statuses are expected, so http_req_failed agrees with our checks.
        responseCallback: http.expectedStatuses(expectedStatus),
      },
    );

    const passed = check(response, {
      [`${spec.endpoint} returns ${expectedStatus}`]: (r) => r.status === expectedStatus,
      ...Object.fromEntries(
        Object.entries(spec.checks ?? {}).map(([name, assertion]) => [
          `${spec.endpoint}: ${name}`,
          // A response that is not what we expected must not be probed further:
          // body parsing on an error page would throw and hide the real failure.
          (r: Response) => r.status === expectedStatus && assertion(r),
        ]),
      ),
    });
    if (!passed) failedChecks += 1;
    return response;
  }

  return {
    get: (path, spec) => send('GET', path, undefined, spec),
    post: (path, body, spec) => send('POST', path, body, spec),
  };
}
