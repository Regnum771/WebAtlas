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
  it('does not call deleteFeature merely from clicking delete — confirmation must gate it', async () => {
    deleteFeature.mockResolvedValue(undefined);
    render(<DisplayPanel />);

    // Pen enters edit mode.
    await userEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));

    // Delete affordance only exists once inside edit mode.
    const deleteBtn = screen.getByRole('button', { name: 'Xóa đối tượng' });
    await userEvent.click(deleteBtn);

    // The dialog must open, and deleteFeature must NOT have fired yet. This is the
    // guard: a regression that wires the delete button straight to confirmDelete
    // (bypassing the dialog) would still show a "Xóa" button somewhere via the
    // ambiguous button text, so we check both the dialog's presence (via its title,
    // which only the ConfirmDialog renders) and that the API call is still pending.
    expect(screen.getByText('Xóa đối tượng này? Hành động không thể hoàn tác.')).toBeInTheDocument();
    expect(deleteFeature).not.toHaveBeenCalled();

    // Now actually confirm — only past this point may the call happen.
    const confirmBtn = screen.getByRole('button', { name: 'Xóa' });
    await userEvent.click(confirmBtn);

    expect(deleteFeature).toHaveBeenCalledWith('dams', 'a1');
  });

  it('cancelling the confirm dialog closes it and never calls deleteFeature', async () => {
    render(<DisplayPanel />);

    await userEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Xóa đối tượng' }));

    // Dialog is open (proven the same way as above) before we act on it.
    expect(screen.getByText('Xóa đối tượng này? Hành động không thể hoàn tác.')).toBeInTheDocument();

    // onCancel={edit.cancelDelete} — the dialog's own cancel button.
    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }));

    expect(screen.queryByText('Xóa đối tượng này? Hành động không thể hoàn tác.')).not.toBeInTheDocument();
    expect(deleteFeature).not.toHaveBeenCalled();
  });

  it('does not show the delete affordance before the pen is pressed', () => {
    render(<DisplayPanel />);
    expect(screen.queryByRole('button', { name: 'Xóa đối tượng' })).not.toBeInTheDocument();
  });
});

describe('DisplayPanel collapse during edit', () => {
  it('keeps edit state coherent — form values and modify lifecycle survive a collapse/expand round trip', async () => {
    render(<DisplayPanel />);

    // Pen: promotes the read-only selection to editable and arms the map's
    // ModifyController via startModify.
    await userEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    expect(startModify).toHaveBeenCalledTimes(1);
    expect(cancelModify).not.toHaveBeenCalled();

    // Type into the form — this is the state that would be lost if the panel were
    // unmounted on collapse (useAttributeFormPresenter seeds via useState, once).
    const nameInput = screen.getByLabelText('geographicalName');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Song Da Edited');
    expect(nameInput).toHaveValue('Song Da Edited');

    // Collapse: the seam toggle button stays visible and functional in both states.
    const seam = screen.getByRole('button', { name: 'Thu gọn' });
    await userEvent.click(seam);
    expect(screen.getByRole('button', { name: 'Mở rộng' })).toBeInTheDocument();

    // A reverted-to-unmounting implementation would cancel the ModifyController
    // implicitly (via cleanup effects) or drop the typed value on remount. Neither
    // may happen: the edit surface's lifecycle is tied to edit mode, not visibility.
    expect(cancelModify).not.toHaveBeenCalled();

    // The panel is still MOUNTED (not unmounted) — proven by reading the raw DOM,
    // bypassing Testing Library's accessible-query filtering which would also return
    // null for a genuinely unmounted tree. This is what distinguishes "hidden" from
    // "gone": a `container.querySelector` hit here is only possible if the subtree,
    // and therefore EditForm's local state, was never torn down.
    const hiddenInput = document.querySelector('#attr-name') as HTMLInputElement | null;
    expect(hiddenInput).not.toBeNull();
    expect(hiddenInput).toHaveValue('Song Da Edited');
    expect(document.querySelector('.display-panel')).toHaveAttribute('hidden');

    // Expand again: the same input, same value — never remounted, never reset.
    await userEvent.click(screen.getByRole('button', { name: 'Mở rộng' }));
    expect(document.querySelector('.display-panel')).not.toHaveAttribute('hidden');
    expect(screen.getByLabelText('geographicalName')).toHaveValue('Song Da Edited');

    // Still armed, still coherent — never cancelled by the collapse round trip.
    expect(cancelModify).not.toHaveBeenCalled();
  });
});
