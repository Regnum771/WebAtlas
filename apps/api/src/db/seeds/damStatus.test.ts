import { describe, it, expect } from 'vitest';
import { assignDamStatus } from './damStatus';
import { DAM_STATUS_SLUGS } from '@webatlas/shared';

describe('assignDamStatus', () => {
  it('is deterministic (same id -> same slug)', () => {
    expect(assignDamStatus('D123')).toBe(assignDamStatus('D123'));
    expect(assignDamStatus(42)).toBe(assignDamStatus(42));
  });

  it('always returns a known slug', () => {
    for (let i = 0; i < 500; i++) {
      expect(DAM_STATUS_SLUGS).toContain(assignDamStatus(`dam-${i}`));
    }
  });

  it('produces all three slugs across a representative id range (variety preserved)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(assignDamStatus(`dam-${i}`));
    expect(seen.has('binh_thuong')).toBe(true);
    expect(seen.has('xa_lu')).toBe(true);
    expect(seen.has('nguy_hiem')).toBe(true);
  });

  it('leans majority-normal (binh_thuong is the most common)', () => {
    const counts: Record<string, number> = { binh_thuong: 0, xa_lu: 0, nguy_hiem: 0 };
    for (let i = 0; i < 1000; i++) counts[assignDamStatus(`dam-${i}`)]++;
    expect(counts.binh_thuong).toBeGreaterThan(counts.xa_lu);
    expect(counts.binh_thuong).toBeGreaterThan(counts.nguy_hiem);
  });
});
