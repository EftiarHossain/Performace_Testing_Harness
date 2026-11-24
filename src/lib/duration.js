// Pure module: no k6 imports, so both k6 scripts and Node tools/tests can use it.

const UNIT_SECONDS = { ms: 0.001, s: 1, m: 60, h: 3600 };

/**
 * Convert a k6-style duration ("90s", "1m30s", "2h", "500ms") to seconds.
 * Profiles declare durations as strings for k6; analysis needs them as numbers
 * to compute expected iteration counts and step boundaries.
 * @param {string} text
 * @returns {number}
 */
export function durationToSeconds(text) {
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)];
  const consumed = parts.reduce((length, part) => length + part[0].length, 0);
  if (parts.length === 0 || consumed !== text.length) {
    throw new Error(`Invalid duration "${text}": expected forms like "30s", "1m30s", "500ms"`);
  }
  return parts.reduce((total, part) => {
    const unit = /** @type {keyof typeof UNIT_SECONDS} */ (part[2]);
    return total + Number(part[1]) * UNIT_SECONDS[unit];
  }, 0);
}
