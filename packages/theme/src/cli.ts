// npm run generate:theme — validates tokens.json, checks contrast, writes generated/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastFailures } from './contrast';
import { generateAll } from './generate';
import { loadTokens } from './tokens';

const OUT = fileURLToPath(new URL('../generated/', import.meta.url));

const tokens = loadTokens();
const failures = contrastFailures(tokens);
if (failures.length > 0) {
  console.error('Text contrast below 4.5:1, nothing written:');
  for (const { fg, bg, ratio } of failures) console.error(`  ${fg} on ${bg}: ${ratio.toFixed(2)}`);
  process.exit(1);
}

for (const [path, content] of generateAll(tokens)) {
  const file = join(OUT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  console.log(`generated/${path}`);
}
