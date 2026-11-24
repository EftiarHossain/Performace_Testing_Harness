// Pure module (no k6 imports): the safety check that decides whether load may be
// sent to a target. Used by the k6 script itself and by the Node run wrapper, so
// bypassing one does not bypass the check.

/**
 * @typedef {object} Environment
 * @property {string} name
 * @property {string} baseUrl
 * @property {string[]} allowedHosts
 * @property {boolean} production
 * @property {string} [serverStatsUrl]  Optional JSON endpoint sampled during a run for server-side metrics.
 */

/**
 * Replace ${VAR} placeholders so real hostnames can stay out of the repository.
 * @param {string} text
 * @param {Record<string, string | undefined>} vars
 */
function interpolate(text, vars) {
  return text.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    const value = vars[name];
    if (!value) throw new Error(`Environment variable ${name} is required but not set`);
    return value;
  });
}

/**
 * @param {Record<string, { baseUrl?: unknown, allowedHosts?: unknown, production?: unknown, serverStatsUrl?: unknown }>} environments
 * @param {string} name
 * @param {Record<string, string | undefined>} vars
 * @returns {Environment}
 */
export function resolveEnvironment(environments, name, vars) {
  const raw = environments[name];
  if (!raw) {
    const known = Object.keys(environments).join(', ');
    throw new Error(`Unknown environment "${name}". Known environments: ${known}`);
  }
  if (typeof raw.baseUrl !== 'string' || !Array.isArray(raw.allowedHosts)) {
    throw new Error(`Environment "${name}" must define baseUrl and allowedHosts`);
  }
  // A missing flag is treated as production: the safe reading of an incomplete entry.
  const production = raw.production !== false;
  return {
    name,
    baseUrl: interpolate(raw.baseUrl, vars).replace(/\/+$/, ''),
    allowedHosts: raw.allowedHosts.map((host) => interpolate(String(host), vars).toLowerCase()),
    production,
    serverStatsUrl:
      typeof raw.serverStatsUrl === 'string' ? interpolate(raw.serverStatsUrl, vars) : undefined,
  };
}

/**
 * @param {string} url
 * @returns {string} lower-cased host without port
 */
export function hostOf(url) {
  const match = /^https?:\/\/([^/:?#@\s]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  if (!match || !match[1]) {
    throw new Error(`Cannot determine host of "${url}": expected http(s)://host[:port]`);
  }
  return match[1].toLowerCase();
}

/**
 * Throws unless load is allowed against this environment.
 * @param {Environment} environment
 * @param {{ allowProduction?: boolean }} [options]
 */
export function assertTargetAllowed(environment, options = {}) {
  const host = hostOf(environment.baseUrl);
  if (!environment.allowedHosts.includes(host)) {
    throw new Error(
      `Refusing to run: host "${host}" is not in the allowlist of environment ` +
        `"${environment.name}" (${environment.allowedHosts.join(', ') || 'empty'})`,
    );
  }
  // Anything else the harness contacts in this environment is held to the same allowlist.
  if (
    environment.serverStatsUrl &&
    !environment.allowedHosts.includes(hostOf(environment.serverStatsUrl))
  ) {
    throw new Error(
      `Refusing to run: serverStatsUrl host "${hostOf(environment.serverStatsUrl)}" is not in the ` +
        `allowlist of environment "${environment.name}"`,
    );
  }
  if (environment.production && !options.allowProduction) {
    throw new Error(
      `Refusing to run: environment "${environment.name}" is marked production. ` +
        'Pass --allow-production only with explicit approval for a production load test.',
    );
  }
}
