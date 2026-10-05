import { defineConfig, configDefaults } from 'vitest/config';

const ISOLATED = [
  'src/modules/analysis/ops/elevationProfile.test.ts',
  'src/modules/assistant/tools/command/command.test.ts',
];

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
    // Seeding no longer happens in a hook: globalSetup loads the layers once per run, and a
    // second run finds them unchanged. What is left in hooks is fixture setup against the shared
    // dev database, which other suites of the same run also load; 60s is margin for that, and a
    // genuine hang still fails. The few tests that rebuild something large carry their own
    // per-test timeout (vitest's third `it()` argument) rather than raising the default above.
    hookTimeout: 60_000,
    isolate: false,

    // Module isolation costs ~30 s of collect time in a 60-file run: every file re-imports the
    // whole app graph. Most files do not need it, so they share one module graph per worker. The
    // two files that vi.mock a module do need it (a mock leaks into later files otherwise), and
    // keep the default isolated worker. A new file that uses vi.mock/vi.spyOn on a module must be
    // added to ISOLATED below.
    projects: [
      { extends: true, test: { name: 'shared', exclude: [...configDefaults.exclude, '**/*.live.test.ts', ...ISOLATED] } },
      { extends: true, test: { name: 'isolated', isolate: true, include: ISOLATED } },
    ],
  },
});
