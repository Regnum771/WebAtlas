import { describe, expect, it } from 'vitest';
import { loadTokens, validateTokens } from './tokens';

/** A deep copy of the committed tokens, to break one field at a time. */
function rawCopy(): Record<string, any> {
  return structuredClone(loadTokens()) as Record<string, any>;
}

describe('tokens', () => {
  it('loads the committed tokens', () => {
    const t = loadTokens();
    expect(t.color.brand).toBe('#14532D');
    expect(t.radius.md).toBe(4);
    expect(t.size.header).toBe(44);
  });

  it('rejects short hex', () => {
    const raw = rawCopy();
    raw.color.ink = '#FFF';
    expect(() => validateTokens(raw)).toThrow(/color\.ink/);
  });

  it('rejects functional colour', () => {
    const raw = rawCopy();
    raw.color.ink = 'rgb(0 0 0)';
    expect(() => validateTokens(raw)).toThrow(/color\.ink/);
  });

  it('keeps hex case', () => {
    const raw = rawCopy();
    raw.color.ink = '#aBcDeF';
    expect(validateTokens(raw).color.ink).toBe('#aBcDeF');
  });

  it('rejects a contrast pair naming a missing token', () => {
    const raw = rawCopy();
    raw.contrast.push(['ink', 'nope']);
    expect(() => validateTokens(raw)).toThrow(/contrast.*nope/);
  });

  it('rejects a negative size', () => {
    const raw = rawCopy();
    raw.radius.md = -1;
    expect(() => validateTokens(raw)).toThrow(/radius\.md/);
  });
});
