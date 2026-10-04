import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests moved here from apps/api unchanged, and they share its database. Same settings
    // as apps/api/vitest.config.ts, for the same reasons: files run one at a time because suites
    // clean up their own rows, and the timeouts are integration budgets, not unit ones.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['./src/testEnv.ts'],
  },
});
