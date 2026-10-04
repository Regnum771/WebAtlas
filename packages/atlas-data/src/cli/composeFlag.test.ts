import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { applyCompose, takeCompose, unexpectedArgument } from './composeFlag';

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

  it('names the command that was run in its errors', () => {
    expect(() => takeCompose(['--compose'], 'atlas:build')).toThrow('atlas:build: --compose requires a file');
  });

  it('applyCompose makes the file this process\'s compose file, relative to where npm was run', () => {
    const env: NodeJS.ProcessEnv = { INIT_CWD: join('/work', 'clone') };
    expect(applyCompose(['--only', 'dams', '--compose', 'infra/other.yml'], 'atlas:build', env)).toEqual({
      compose: 'infra/other.yml', rest: ['--only', 'dams'],
    });
    expect(env.ATLAS_COMPOSE_FILE).toMatch(/[\\/]work[\\/]clone[\\/]infra[\\/]other\.yml$/);
    const untouched: NodeJS.ProcessEnv = {};
    applyCompose(['--only', 'dams'], 'atlas:build', untouched);
    expect(untouched.ATLAS_COMPOSE_FILE).toBeUndefined();
  });

  it('the commands that never use Docker say so instead of accepting --compose', () => {
    expect(unexpectedArgument('atlas:status', '--compose')).toMatch(/--compose has no effect here.*DATABASE_URL and GEOSERVER_URL/);
    expect(unexpectedArgument('atlas:verify', '--compose=x.yml')).toMatch(/--compose has no effect here/);
    expect(unexpectedArgument('atlas:adopt', '--only')).toBe('atlas:adopt: unexpected argument "--only" (atlas:adopt takes no arguments)');
  });
});
