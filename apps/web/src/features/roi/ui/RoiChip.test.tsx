import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { ResolvedRoi } from '@webatlas/shared';

const state = vi.hoisted(() => ({ run: vi.fn(), ctx: { map: {} } }));
vi.mock('../../map/model/useMapCommands', () => ({ useMapCommands: () => state.run }));
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => state.ctx }));

import { resetRoiStore, setRoi, setRoiResolver } from '../model/roi.store';
import RoiChip from './RoiChip';

const line: ResolvedRoi = {
  label: 'Sông Thu Bồn', kind: 'line', measure: { lengthKm: 212.4 },
  display: { type: 'LineString', coordinates: [[108, 15], [108.1, 15.1]] }, bbox: [108, 15, 108.1, 15.1], centroid: [108.05, 15.05],
};

describe('RoiChip container', () => {
  beforeEach(() => { resetRoiStore(); state.run = vi.fn(); });

  it('redraws only on a new resolution, not when the executor is rebuilt', async () => {
    setRoiResolver(vi.fn().mockResolvedValue(line));
    const { rerender } = render(<RoiChip />);
    const first = state.run;
    await act(async () => { await setRoi({ source: 'feature', layerKey: 'rivers', featureId: 'r1', whole: true }, { fit: true }); });
    expect(first.mock.calls.filter(([c]) => c.kind === 'showRoi')).toHaveLength(1);

    const second = vi.fn();
    state.run = second;
    rerender(<RoiChip />);
    expect(second).not.toHaveBeenCalled();
    expect(first.mock.calls.filter(([c]) => c.kind === 'showRoi')).toHaveLength(1);
  });
});
