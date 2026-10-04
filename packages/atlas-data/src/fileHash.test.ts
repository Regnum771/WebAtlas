import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plannedHashOfFile, sha256OfFile, stageFileHashes, versionSource } from './fileHash';
import { stageInputHash } from './state';
import { resolveStageFile, DATA_DIR, REPO_ROOT } from './paths';
import type { Stage } from './types';

const dir = mkdtempSync(join(tmpdir(), 'file-hash-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stage = (files: Array<{ file: string }>): Extract<Stage, { type: 'load-geojson' }> => ({
  type: 'load-geojson', layer: 'rivers', versioned: true,
  files: files.map((f) => ({ ...f, columns: () => ({}) })),
});
const fake = (p: string) => `hash-of-${p.split(/[\\/]/).pop()}`;

describe('file hashing for load-geojson', () => {
  it('hashes file content, not its timestamp', () => {
    const f = join(dir, 'a.geojson');
    writeFileSync(f, '{"type":"FeatureCollection","features":[]}');
    const first = sha256OfFile(f);
    writeFileSync(f, '{"type":"FeatureCollection","features":[]}');
    expect(sha256OfFile(f)).toBe(first);
    expect(first).toBe(createHash('sha256').update('{"type":"FeatureCollection","features":[]}').digest('hex'));
  });

  it('fails with the path when a file is missing', () => {
    expect(() => sha256OfFile(join(dir, 'nope.geojson'))).toThrow(/nope\.geojson/);
  });

  it('planning tolerates a missing file: it hashes as missing instead of stopping every command', () => {
    const f = join(dir, 'planned.geojson');
    writeFileSync(f, '{}');
    expect(plannedHashOfFile(f)).toBe(sha256OfFile(f));
    expect(plannedHashOfFile(join(dir, 'nope.geojson'))).toBe('missing');
    // The default of the stage hash: status, verify and build plan every dataset before running any.
    const stage = { type: 'load-geojson' as const, layer: 'dams', versioned: true, files: [{ file: 'seeds/__not_there__.geojson', columns: () => ({}) }] };
    expect(() => stageInputHash(stage, [])).not.toThrow();
    // Loading it is another matter: that needs the bytes, and says which file it could not read.
    expect(() => versionSource(stage)).toThrow(/__not_there__\.geojson/);
  });

  it('resolves a stage file under data/ by default and under the repo root when asked', () => {
    expect(resolveStageFile({ file: 'seeds/dams.geojson' })).toBe(join(DATA_DIR, 'seeds', 'dams.geojson'));
    expect(resolveStageFile({ file: 'apps/web/public/provinces-34.geojson', root: 'repo' }))
      .toBe(join(REPO_ROOT, 'apps', 'web', 'public', 'provinces-34.geojson'));
  });

  it('hashes every file of a stage, in order', () => {
    expect(stageFileHashes(stage([{ file: 'seeds/a.geojson' }, { file: 'seeds/b.geojson' }]), fake))
      .toEqual(['hash-of-a.geojson', 'hash-of-b.geojson']);
  });

  it('builds the version source from the file names and the hash of their hashes', () => {
    const src = versionSource(stage([{ file: 'seeds/a.geojson' }, { file: 'seeds/b.geojson' }]), fake);
    const digest = createHash('sha256').update('hash-of-a.geojsonhash-of-b.geojson').digest('hex');
    expect(src).toBe(`a.geojson+b.geojson@sha256:${digest}`);
  });
});
