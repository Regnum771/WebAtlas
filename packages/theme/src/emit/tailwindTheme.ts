import type { Tokens } from '../tokens';
import { block, cssValues } from './css';

// Tailwind v4 theme namespaces. Sizes go to spacing (h-row, w-row, gap-gap); motion has none.
const NAMESPACE: Record<keyof Tokens, string> = {
  color: 'color',
  colorDark: 'color-dark',
  radius: 'radius',
  shadow: 'shadow',
  font: 'font',
  text: 'text',
  size: 'spacing',
  motion: 'motion',
  contrast: '',
};

/** The @theme block the web app imports; literal values, so it needs no other file. */
export function emitTailwindTheme(t: Tokens): string {
  return block(
    '@theme',
    cssValues(t).map(([group, key, value]) => [`--${NAMESPACE[group]}-${key}`, value]),
  );
}
