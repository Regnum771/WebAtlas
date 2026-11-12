import { targets } from './targets';
import type { Tokens } from './tokens';

/** Every generated file: path relative to generated/ → content (LF endings). */
export function generateAll(t: Tokens): Map<string, string> {
  return new Map(targets.map((target) => [target.path, target.emit(t)]));
}
