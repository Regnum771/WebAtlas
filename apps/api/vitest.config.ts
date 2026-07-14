import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration suites share one dev PostGIS database and clean up their own
    // rows by an `@webatlas.test` namespace. Running test files in parallel lets
    // one suite's afterAll cleanup delete another suite's in-flight fixture rows
    // (e.g. a broad `DELETE ... LIKE '%@webatlas.test'`), causing cross-suite
    // flakiness. Serialize files so each suite owns the DB for its duration.
    fileParallelism: false,
  },
});
