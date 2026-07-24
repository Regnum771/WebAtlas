import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration suites share one dev PostGIS database and clean up their own
    // rows by an `@webatlas.test` namespace. Running test files in parallel lets
    // one suite's afterAll cleanup delete another suite's in-flight fixture rows
    // (e.g. a broad `DELETE ... LIKE '%@webatlas.test'`), causing cross-suite
    // flakiness. Serialize files so each suite owns the DB for its duration.
    fileParallelism: false,

    // These are integration suites, not unit tests: nearly every test does real
    // round-trips to PostGIS or GeoServer, whose latency varies with load and
    // with how much history the shared dev DB has accumulated. Vitest's 5s
    // default is a unit-test budget and was firing on a different test each run
    // (seeds, WFS publication, backfill) purely as a timing artifact rather than
    // a real defect. A genuinely hung query still fails the suite, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
