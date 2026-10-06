import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ResolvedRoi } from '@webatlas/shared';

vi.mock('../map/model/useMapCommands', () => ({ useMapCommands: () => vi.fn() }));

import { useAnalysisTools } from './index';
import { resetRoiStore, setRoi, setRoiResolver } from '../roi/model/roi.store';

const line: ResolvedRoi = {
  label: 'Sông Thu Bồn', kind: 'line', measure: { lengthKm: 212.4 },
  display: { type: 'LineString', coordinates: [[108, 15], [108.1, 15.1]] }, bbox: [108, 15, 108.1, 15.1], centroid: [108.05, 15.05],
};

function Harness() {
  const { buttons, panel } = useAnalysisTools();
  return <>{buttons}{panel}</>;
}

describe('useAnalysisTools', () => {
  beforeEach(() => resetRoiStore());

  it('with no region, the tools share the one line that asks for a region', () => {
    render(<Harness />);
    expect(screen.getAllByText('Vẽ hoặc chọn một vùng trước.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Gần nhất' })).toHaveAccessibleDescription('Vẽ hoặc chọn một vùng trước.');
  });

  it('with a region, each tool it does not suit gives its own reason', async () => {
    setRoiResolver(() => Promise.resolve(line));
    render(<Harness />);
    await act(async () => { await setRoi({ source: 'feature', layerKey: 'rivers', featureId: 'r1', whole: true }, { fit: false }); });
    expect(screen.queryByText('Vẽ hoặc chọn một vùng trước.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Thống kê độ cao' })).toHaveAccessibleDescription('Cần một vùng — thêm bán kính');
    expect(screen.getByRole('button', { name: 'Gần nhất' })).not.toHaveAttribute('aria-disabled');
  });
});
