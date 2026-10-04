import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realSystem } from './system';

describe('realSystem', () => {
  it('freeBytes walks up from a path that does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-up-'));
    expect(await realSystem().freeBytes(join(dir, 'a', 'b', 'c'))).toBeGreaterThan(0);
  });
  it('exec on a missing executable returns code null with the error, not a throw', async () => {
    const r = await realSystem().exec('atlas-no-such-executable-xyz', [], { quiet: true });
    expect(r.code).toBeNull();
    expect(r.tail.join('\n').length).toBeGreaterThan(0);
  });
  it('status of an unreachable URL is 0', async () => {
    expect(await realSystem().status('http://127.0.0.1:1/x', { user: 'a', password: 'b' })).toBe(0);
  });
});
