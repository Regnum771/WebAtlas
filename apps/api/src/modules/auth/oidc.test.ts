import { describe, expect, it } from 'vitest';
import { newLoginState, readCookie, safeReturnTo, signState, verifyState } from './oidc';

const SECRET = 'test-secret-at-least-16';

describe('login state cookie', () => {
  it('round-trips a signed state until it expires', () => {
    const s = newLoginState('/ban-do', 1_000);
    const v = signState(s, SECRET);
    expect(verifyState(v, SECRET, 2_000)).toEqual(s);
    expect(verifyState(v, SECRET, s.exp + 1)).toBeNull();
  });

  it('refuses a tampered body, a wrong key and garbage', () => {
    const v = signState(newLoginState('/'), SECRET);
    const [body, sig] = v.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), returnTo: '/x' })).toString('base64url');
    expect(verifyState(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyState(v, 'another-secret-16chars')).toBeNull();
    expect(verifyState('nope', SECRET)).toBeNull();
    expect(verifyState(undefined, SECRET)).toBeNull();
  });

  it('is not a JWT, so it can never pass as a bearer token', () => {
    expect(signState(newLoginState('/'), SECRET).split('.')).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('readCookie finds one cookie among several', () => {
    expect(readCookie('a=1; webatlas_oidc=x%2Ey; b=2', 'webatlas_oidc')).toBe('x.y');
    expect(readCookie(undefined, 'webatlas_oidc')).toBeUndefined();
  });

  it('safeReturnTo keeps in-app paths only', () => {
    expect(safeReturnTo('/du-lieu/dams?x=1')).toBe('/du-lieu/dams?x=1');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 42, undefined]) {
      expect(safeReturnTo(bad)).toBe('/');
    }
  });
});
