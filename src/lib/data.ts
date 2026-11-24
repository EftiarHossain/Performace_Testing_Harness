// Test data helpers. SharedArray keeps one read-only copy of a data file for all
// VUs instead of one copy per VU, which matters once files or VU counts grow.
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

/** Load a JSON array once and share it across VUs. Must be called in init context. */
export function loadJsonArray<T>(name: string, path: string): T[] {
  return new SharedArray(name, () => {
    const rows: unknown = JSON.parse(open(path));
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`Data file ${path} must be a non-empty JSON array`);
    }
    return rows;
  }) as T[];
}

/** A stable row for the current VU: the same VU always gets the same row. */
export function rowForVu<T>(rows: T[]): T {
  return rows[(exec.vu.idInTest - 1) % rows.length] as T;
}

export function randomRow<T>(rows: T[]): T {
  return rows[Math.floor(Math.random() * rows.length)] as T;
}

export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
