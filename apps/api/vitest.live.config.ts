import { defineConfig } from 'vitest/config';

// A separate config for the live-model suite. The default vitest.config.ts
// excludes **/*.live.test.ts from the default run — a pattern that also wins
// over a file named explicitly on the vitest CLI, so `vitest run
// src/.../assistant.live.test.ts` under the default config reports "No test
// files found" rather than running it. This config carries no such exclude
// and is scoped, via `include`, to the live suite alone.
export default defineConfig({
  test: {
    include: ['src/modules/assistant/assistant.live.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
