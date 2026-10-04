import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

// Read and write the base tables on purpose: the layer registry names them, the layers
// repository writes edit drafts into them, and the scripts build derived data.
const ALLOWED = ['layers/registry.ts', 'modules/layers/repository.ts', 'scripts/'];

// A thematic base table in SQL text: water.<layer>, or water.${...}, not followed by a suffix
// such as _active, _detail or _overview.
const BASE_TABLE =
  /water\.(?:dams|stations|flood_zones|drought_points|saltwater_intrusion|flood_generation|lakes|rivers|\$\{[^}]+\})(?![a-z_]|\$\{)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'migrations' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the active state is read through the *_active views (S1 spec §2)', () => {
  it('no source file outside the allow-list names a thematic base table in code', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (ALLOWED.some((a) => rel.startsWith(a))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (BASE_TABLE.test(code)) offenders.push(`${rel}:${i + 1}: ${code}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
