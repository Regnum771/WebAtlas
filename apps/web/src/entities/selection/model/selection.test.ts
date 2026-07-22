import { describe, it, expect } from 'vitest';
import { parseFeatureId, resolveLayerKey } from './selection';

describe('parseFeatureId', () => {
  it('splits a WFS id into typename and bare id', () => {
    expect(parseFeatureId('dams.a1b2c3')).toEqual({ typename: 'dams', featureId: 'a1b2c3' });
  });

  it('keeps a uuid containing dots intact after the first dot', () => {
    expect(parseFeatureId('rivers.a.b.c')).toEqual({ typename: 'rivers', featureId: 'a.b.c' });
  });

  it('treats an id with no dot as a bare id with no typename', () => {
    expect(parseFeatureId('plain-id')).toEqual({ typename: '', featureId: 'plain-id' });
  });

  it('handles an empty id without throwing', () => {
    expect(parseFeatureId('')).toEqual({ typename: '', featureId: '' });
  });
});

describe('resolveLayerKey', () => {
  const map = { 'dams-layer': 'dams', 'rivers-layer': 'rivers' } as const;

  it('resolves a known typename to its layer key', () => {
    expect(resolveLayerKey('dams', { ...map })).toBe('dams');
  });

  it('returns null for a typename that is not an editable layer', () => {
    expect(resolveLayerKey('provinces', { ...map })).toBeNull();
    expect(resolveLayerKey('', { ...map })).toBeNull();
  });
});
