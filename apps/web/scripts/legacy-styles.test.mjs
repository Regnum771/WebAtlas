import { describe, expect, it } from 'vitest';
import { diffSnapshots, elementKey, PROPERTIES } from './legacy-styles.mjs';

describe('diffSnapshots', () => {
  it('returns nothing for equal snapshots', () => {
    const snap = { 'body>main': { color: 'rgb(0, 0, 0)' } };
    expect(diffSnapshots(snap, structuredClone(snap))).toEqual([]);
  });

  it('names the key, property and both values of a change', () => {
    const before = { 'body>main': { color: 'rgb(0, 0, 0)', display: 'block' } };
    const after = { 'body>main': { color: 'rgb(1, 1, 1)', display: 'block' } };
    expect(diffSnapshots(before, after)).toEqual(['body>main: color rgb(0, 0, 0) → rgb(1, 1, 1)']);
  });

  it('reports keys present on one side only', () => {
    const before = { a: { color: 'x' }, b: { color: 'x' } };
    const after = { b: { color: 'x' }, c: { color: 'x' } };
    expect(diffSnapshots(before, after)).toEqual(['missing: a', 'added: c']);
  });
});

describe('elementKey', () => {
  it('numbers the second of two identical siblings and sorts classes', () => {
    const seen = new Map();
    expect(elementKey(['body', 'main', 'div.row'], seen)).toBe('body>main>div.row');
    expect(elementKey(['body', 'main', 'div.row'], seen)).toBe('body>main>div.row#2');
    expect(elementKey(['body', 'main', 'div.b.a'], new Map())).toBe('body>main>div.a.b');
  });
});

describe('PROPERTIES', () => {
  it('covers the per-side box properties', () => {
    expect(PROPERTIES).toContain('padding-left');
    expect(PROPERTIES).toContain('border-bottom-color');
    expect(PROPERTIES).toContain('appearance');
  });

  it('covers layout and visual style, but not layout results', () => {
    for (const name of ['gap', 'align-items', 'border-top-left-radius', 'box-shadow', 'overflow-y', 'opacity', 'z-index', 'letter-spacing', 'white-space', 'text-transform', 'grid-template-columns']) {
      expect(PROPERTIES).toContain(name);
    }
    for (const name of ['width', 'height', 'top', 'left', 'right', 'bottom']) expect(PROPERTIES).not.toContain(name);
  });
});
