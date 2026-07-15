import { describe, it, expect } from 'vitest';
import {
  DAM_STATUS_SLUGS,
  DAM_STATUS_DISPLAY,
  toDamStatusSlug,
  damStatusDisplay,
} from './dam-status';

describe('dam-status vocabulary', () => {
  it('has exactly the three canonical slugs', () => {
    expect([...DAM_STATUS_SLUGS]).toEqual(['binh_thuong', 'xa_lu', 'nguy_hiem']);
  });

  it('maps every slug to a label + color', () => {
    expect(DAM_STATUS_DISPLAY.binh_thuong).toEqual({ label: 'Bình thường', color: '#10b981' });
    expect(DAM_STATUS_DISPLAY.xa_lu).toEqual({ label: 'Xả lũ', color: '#f59e0b' });
    expect(DAM_STATUS_DISPLAY.nguy_hiem).toEqual({ label: 'Nguy hiểm', color: '#ef4444' });
  });

  it('toDamStatusSlug passes through known slugs', () => {
    expect(toDamStatusSlug('xa_lu')).toBe('xa_lu');
    expect(toDamStatusSlug('nguy_hiem')).toBe('nguy_hiem');
  });

  it('toDamStatusSlug coerces known Vietnamese labels back to slugs', () => {
    expect(toDamStatusSlug('Nguy hiểm')).toBe('nguy_hiem');
    expect(toDamStatusSlug('Xả lũ')).toBe('xa_lu');
    expect(toDamStatusSlug('Bình thường')).toBe('binh_thuong');
  });

  it('toDamStatusSlug defaults null/unknown to binh_thuong', () => {
    expect(toDamStatusSlug(null)).toBe('binh_thuong');
    expect(toDamStatusSlug(undefined)).toBe('binh_thuong');
    expect(toDamStatusSlug('garbage')).toBe('binh_thuong');
    expect(toDamStatusSlug(42)).toBe('binh_thuong');
  });

  it('damStatusDisplay returns the label+color for a value', () => {
    expect(damStatusDisplay('nguy_hiem')).toEqual({ label: 'Nguy hiểm', color: '#ef4444' });
    expect(damStatusDisplay(null)).toEqual({ label: 'Bình thường', color: '#10b981' });
  });
});
