import { describe, it, expect } from 'vitest';
import { PERSONAS, rolePersonas } from './persona';

describe('rolePersonas', () => {
  it('admin gets steward + admin (superset)', () => {
    expect(rolePersonas('admin')).toEqual(['steward', 'admin']);
  });
  it('editor gets steward', () => {
    expect(rolePersonas('editor')).toEqual(['steward']);
  });
  it('viewer gets governance + research', () => {
    expect(rolePersonas('viewer')).toEqual(['governance', 'research']);
  });
  it('anonymous / undefined gets public', () => {
    expect(rolePersonas(null)).toEqual(['public']);
    expect(rolePersonas(undefined)).toEqual(['public']);
  });
});

describe('PERSONAS registry', () => {
  it('has a label + requiredRole for every id', () => {
    for (const id of ['public', 'governance', 'research', 'steward', 'admin'] as const) {
      expect(PERSONAS[id].id).toBe(id);
      expect(typeof PERSONAS[id].label).toBe('string');
    }
    expect(PERSONAS.public.requiredRole).toBeNull();
    expect(PERSONAS.steward.requiredRole).toBe('editor');
  });
});
