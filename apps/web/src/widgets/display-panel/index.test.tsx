import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const deleteFeature = vi.fn();
const refreshLayer = vi.fn();
const startModify = vi.fn();
const cancelModify = vi.fn();

let currentSelection: unknown = null;
let personaAvailable: string[] = ['steward'];

vi.mock('../../features/feature-editing/api/features.api', () => ({
  deleteFeature: (...args: unknown[]) => deleteFeature(...args),
}));

vi.mock('../../features/map/model/mapEditing', () => ({
  useMapEditing: () => ({ startModify, cancelModify, refreshLayer }),
}));

vi.mock('../../entities/selection', () => ({
  useSelection: () => ({
    selection: currentSelection,
    clear: vi.fn(),
  }),
}));

vi.mock('../../entities/persona/usePersona', () => ({
  usePersona: () => ({ available: personaAvailable }),
}));

vi.mock('../../features/map/model/geo', () => ({
  olGeometryTo4326GeoJSON: () => ({ type: 'Point', coordinates: [108, 13] }),
}));

import DisplayPanel from './index';

const damSelection = {
  layerKey: 'dams',
  featureId: 'a1',
  feature: { getGeometry: () => ({ fake: 'geometry' }) },
  isoProps: { geographicalName: 'Hoa Binh' },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSelection = damSelection;
  personaAvailable = ['steward'];
});

describe('DisplayPanel delete path', () => {
  it('reaches deleteFeature via pen -> edit mode -> delete -> confirm', async () => {
    deleteFeature.mockResolvedValue(undefined);
    render(<DisplayPanel />);

    // Pen enters edit mode.
    await userEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));

    // Delete affordance only exists once inside edit mode.
    const deleteBtn = screen.getByRole('button', { name: /delete feature/i });
    await userEvent.click(deleteBtn);

    // Confirm dialog appears; confirming calls deleteFeature with the right arguments.
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    await userEvent.click(confirmBtn);

    expect(deleteFeature).toHaveBeenCalledWith('dams', 'a1');
  });

  it('does not show the delete affordance before the pen is pressed', () => {
    render(<DisplayPanel />);
    expect(screen.queryByRole('button', { name: /delete feature/i })).not.toBeInTheDocument();
  });
});
