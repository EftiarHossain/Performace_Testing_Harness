// Authentication helper: log a pool of users in once during setup() and reuse the
// tokens, so that login load in the test is exactly what the workload model's
// "login" weight says and not a side effect of every iteration authenticating.
import type { Client } from './http.ts';
import { rowForVu } from './data.ts';

export interface Credentials {
  username: string;
  password: string;
}

/** Call from setup(). Throws if any login fails, so a broken environment stops the run early. */
export function loginAll(
  client: Client,
  users: Credentials[],
  login: (client: Client, user: Credentials) => string | undefined,
): string[] {
  return users.map((user) => {
    const token = login(client, user);
    if (!token) throw new Error(`Setup login failed for user "${user.username}"`);
    return token;
  });
}

/** The current VU's token; VUs share tokens when there are more VUs than users. */
export function tokenForVu(tokens: string[]): string {
  return rowForVu(tokens);
}
