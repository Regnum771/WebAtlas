import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFitOnScenario } from './useFitOnScenario';

const extent: [number, number, number, number] = [1, 2, 3, 4];

describe('useFitOnScenario', () => {
  it('flies to the area each time a different scenario arrives, not on every render', () => {
    const fit = vi.fn();
    const map = { getView: () => ({ fit }) } as never;
    const { rerender } = renderHook(({ id }) => useFitOnScenario(map, id, id ? extent : null), { initialProps: { id: null as string | null } });
    expect(fit).not.toHaveBeenCalled();
    rerender({ id: 'kttv-2025-10' });
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0][0]).toEqual(extent);
    rerender({ id: 'kttv-2025-10' });
    expect(fit).toHaveBeenCalledTimes(1);
    rerender({ id: 'preset-1300' });
    expect(fit).toHaveBeenCalledTimes(2);
  });
});
