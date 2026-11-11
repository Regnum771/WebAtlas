import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateAll } from './generate';
import { loadTokens } from './tokens';

const GENERATED = fileURLToPath(new URL('../generated/', import.meta.url));

/** Every file under generated/, as forward-slash paths relative to it. */
function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(`${dir}/${entry.name}`, `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

describe('generated files', () => {
  const expected = generateAll(loadTokens());

  it('committed files match the generator', () => {
    for (const [path, content] of expected) {
      const file = `${GENERATED}${path}`;
      expect(existsSync(file), `generated/${path} is missing: run npm run generate:theme`).toBe(true);
      // A Windows checkout may hold CRLF despite .gitattributes; compare content, not line endings.
      const onDisk = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      expect(onDisk, `generated/${path} is stale: run npm run generate:theme`).toBe(content);
    }
  });

  it('no stray generated files', () => {
    expect(listFiles(GENERATED).sort()).toEqual([...expected.keys()].sort());
  });
});
