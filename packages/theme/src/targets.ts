import { emitTailwindTheme } from './emit/tailwindTheme';
import { emitTokensCss } from './emit/tokensCss';
import type { Tokens } from './tokens';

/** One generated file. `path` is relative to packages/theme/generated/. */
export type Target = { id: string; path: string; emit: (t: Tokens) => string };

// K6–K8 add the Keycloak, GeoNode and Dagster targets here.
export const targets: readonly Target[] = [
  { id: 'tokens-css', path: 'tokens.css', emit: emitTokensCss },
  { id: 'tailwind-theme', path: 'tailwind-theme.css', emit: emitTailwindTheme },
];
