import { describe, expect, it } from 'vitest';
import { cn } from './utils';

// tailwind-merge must know the theme's custom scales, or it drops classes it thinks conflict.
describe('cn', () => {
  it('keeps a text colour and a text size side by side', () => {
    expect(cn('text-ink', 'text-body').split(' ').sort()).toEqual(['text-body', 'text-ink']);
  });
  it('lets the later of two control heights win', () => {
    expect(cn('h-control', 'h-control-sm')).toBe('h-control-sm');
  });
  it('lets the later of two radii win', () => {
    expect(cn('rounded-md', 'rounded-lg')).toBe('rounded-lg');
  });
  it('lets the later of two background colours win', () => {
    expect(cn('bg-brand', 'bg-alert')).toBe('bg-alert');
  });
  it('keeps a shadow and a border colour side by side', () => {
    expect(cn('shadow-pop', 'border-line').split(' ').sort()).toEqual(['border-line', 'shadow-pop']);
  });
});
