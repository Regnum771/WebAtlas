import type { Tokens } from '../tokens';
import { block, cssValues } from './css';

const PREFIX: Record<keyof Tokens, string> = {
  color: 'color',
  colorDark: 'color-dark',
  radius: 'radius',
  shadow: 'shadow',
  font: 'font',
  text: 'text',
  size: 'size',
  motion: 'motion',
  contrast: '',
};

/** Plain custom properties (--wa-<group>-<name>) for any consumer, Tailwind or not. */
export function emitTokensCss(t: Tokens): string {
  return block(
    ':root',
    cssValues(t).map(([group, key, value]) => [`--wa-${PREFIX[group]}-${key}`, value]),
  );
}
