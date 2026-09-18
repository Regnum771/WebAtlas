import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Map } from 'ol';
import { ExportBlockedError } from '../../../features/map/model/exportMap';
import { usePrintPage } from './usePrintPage';

const map = {} as Map;
beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:map');
  globalThis.URL.revokeObjectURL = vi.fn();
});

function deps(over = {}) {
  return {
    map, basemap: 'street' as const, visibleLayerIds: ['layer_dams', 'layer_contours'], crsLabel: 'WGS 84',
    exporter: {
      exportMapCanvas: vi.fn().mockResolvedValue({} as HTMLCanvasElement),
      canvasToPngBlob: vi.fn().mockResolvedValue(new Blob(['x'])),
    },
    ...over,
  };
}

describe('usePrintPage', () => {
  it('captures the map at the paper aspect on mount', async () => {
    const d = deps();
    const { result } = renderHook(() => usePrintPage(d));
    await waitFor(() => expect(result.current.imageUrl).toBe('blob:map'));
    expect(d.exporter.exportMapCanvas).toHaveBeenCalledWith(map, 297 / 210);
  });

  it('recaptures when the orientation changes', async () => {
    const d = deps();
    const { result } = renderHook(() => usePrintPage(d));
    await waitFor(() => expect(result.current.imageUrl).toBe('blob:map'));
    act(() => result.current.setPaper('A4-portrait'));
    await waitFor(() => expect(d.exporter.exportMapCanvas).toHaveBeenLastCalledWith(map, 210 / 297));
  });

  it('explains a blocked export', async () => {
    const d = deps();
    d.exporter.canvasToPngBlob.mockRejectedValue(new ExportBlockedError());
    const { result } = renderHook(() => usePrintPage(d));
    await waitFor(() => expect(result.current.exportError).toContain('máy chủ bản đồ nền chặn'));
    expect(result.current.imageUrl).toBeNull();
  });

  it('always lists the basemap and visible-layer attributions', () => {
    const { result } = renderHook(() => usePrintPage(deps()));
    expect(result.current.attributions[0]).toContain('OpenStreetMap');
    expect(result.current.attributions.some((a) => a.includes('FABDEM'))).toBe(true);
  });
});
