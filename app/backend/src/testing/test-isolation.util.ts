/**
 * Per-test isolation helper (BE-127).
 *
 * Each `createTestIsolation` call returns a helper that seeds a uniquely
 * namespaced deterministic dataset (`seed()`), removes it again (`cleanup()`)
 * and reports the active namespace (`getPrefix()`). Because every test gets
 * its own prefix, no test can observe records seeded by another test, and the
 * suite stays green when files run in a randomised order.
 */
import { cleanDatabase, resetDatabase, type SeedClient, type SeedDatabaseOptions } from './seed.util';

let isolationCounter = 0;

export interface TestIsolation {
  /** Seeds a fresh, uniquely-namespaced dataset and returns the prefix used. */
  seed(): Promise<string>;
  /** Removes the dataset created by `seed()` so state is restored. */
  cleanup(): Promise<void>;
  /** Returns the current idPrefix, or empty string if no seed has run. */
  getPrefix(): string;
}

/**
 * Creates a per-test isolation helper backed by the given seed client.
 *
 * Use in `beforeEach` / `afterEach`:
 *   beforeEach(async () => { await isolation.seed(); });
 *   afterEach(async () => { await isolation.cleanup(); });
 */
export function createTestIsolation(
  client: SeedClient,
  options: SeedDatabaseOptions = {},
): TestIsolation {
  let prefix = '';

  return {
    async seed(): Promise<string> {
      if (!prefix) {
        prefix = `iso_${++isolationCounter}`;
      }
      await resetDatabase(client, {
        ...options,
        idPrefix: `${prefix}_`,
      });
      return prefix;
    },

    async cleanup(): Promise<void> {
      if (prefix) {
        await cleanDatabase(client, `${prefix}_`, options);
        prefix = '';
      }
    },

    getPrefix(): string {
      return prefix;
    },
  };
}