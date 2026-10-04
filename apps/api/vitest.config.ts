import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Seeds the thematic layers once per run; see the file.
    globalSetup: ['./src/test/globalSetup.ts'],

    // Live-model suites cost real API tokens on every execution, so they are
    // opt-in (`npm run test:api:live`) rather than part of the default run.
    exclude: [...configDefaults.exclude, '**/*.live.test.ts'],

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
    // seed.test.ts's beforeAll runs the full seed pipeline (now including admin-code
    // stamping) against the live DB. Measured 29-45s standalone; the full API suite adds
    // contention from other suites hitting the same dev DB in the same run. 60s keeps
    // comfortable margin above the observed worst case without masking a genuine hang.
    //
    // Two test bodies in seed.test.ts (and one in modules/versions/integration.test.ts)
    // also call the full seed/ingest pipeline a second time from inside the test itself,
    // not just in beforeAll. That cost is billed against testTimeout, not hookTimeout, so
    // raising hookTimeout alone doesn't cover them — each of those tests instead carries
    // its own per-test timeout (vitest's third `it()` argument) rather than raising this
    // suite-wide default, which stays a tight ceiling for the many tests that don't re-run
    // a seed/ingest.
    hookTimeout: 60_000,
  },
});
