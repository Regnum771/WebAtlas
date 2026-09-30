import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDevEnv } from './env';

const KEY = '__ATLASDATA_TEST_ENV__';
let dir = '';
const saved = process.env.DATABASE_URL;

afterEach(async () => {
  delete process.env[KEY];
  if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('loadDevEnv', () => {
  it('loads the dev env file when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    dir = await mkdtemp(join(tmpdir(), 'atlas-env-'));
    const file = join(dir, '.env');
    await writeFile(file, `${KEY}=from-file\nDATABASE_URL=postgres://x/y\n`);
    expect(loadDevEnv(file)).toBe(file);
    expect(process.env[KEY]).toBe('from-file');
    expect(process.env.DATABASE_URL).toBe('postgres://x/y');
  });

  it('does nothing when DATABASE_URL is already set — an explicit environment wins', async () => {
    process.env.DATABASE_URL = 'postgres://explicit/db';
    dir = await mkdtemp(join(tmpdir(), 'atlas-env-'));
    const file = join(dir, '.env');
    await writeFile(file, `${KEY}=from-file\n`);
    expect(loadDevEnv(file)).toBeNull();
    expect(process.env[KEY]).toBeUndefined();
  });

  it('returns null when the file does not exist', () => {
    delete process.env.DATABASE_URL;
    expect(loadDevEnv(join(tmpdir(), 'definitely-missing-atlas.env'))).toBeNull();
  });
});
