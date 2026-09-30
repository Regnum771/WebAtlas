import { describe, it, expect } from 'vitest';
import { takeCompose } from './composeFlag';

describe('takeCompose', () => {
  it('takes --compose x and leaves the rest', () => {
    expect(takeCompose(['--only', 'demo', '--compose', 'x.yml'])).toEqual({ compose: 'x.yml', rest: ['--only', 'demo'] });
  });
  it('takes --compose=x', () => {
    expect(takeCompose(['--compose=x.yml', '--force', 'a'])).toEqual({ compose: 'x.yml', rest: ['--force', 'a'] });
  });
  it('is absent when not given', () => {
    expect(takeCompose(['--only', 'demo'])).toEqual({ compose: undefined, rest: ['--only', 'demo'] });
  });
  it('rejects a missing value', () => {
    expect(() => takeCompose(['--compose'])).toThrow(/requires a file/);
  });
  it('rejects a following flag', () => {
    expect(() => takeCompose(['--compose', '--only', 'demo'])).toThrow(/requires a file/);
  });
  it('rejects an empty --compose=', () => {
    expect(() => takeCompose(['--compose='])).toThrow(/requires a file/);
  });
});
