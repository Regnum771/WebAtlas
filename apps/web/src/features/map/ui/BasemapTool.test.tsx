import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ run: vi.fn(), ctx: { basemap: 'street' } }));
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => h.ctx }));
vi.mock('../model/useMapCommands', () => ({ useMapCommands: () => h.run }));

import BasemapTool, { BasemapToolView } from './BasemapTool';

describe('BasemapToolView', () => {
  it('offers the three basemaps as one radio group', () => {
    render(<BasemapToolView active="street" onBasemap={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'Nền bản đồ' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Đường phố', 'Vệ tinh', 'Địa hình']);
  });

  it('checks only the basemap in use', () => {
    render(<BasemapToolView active="satellite" onBasemap={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Vệ tinh' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Đường phố' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Địa hình' })).not.toBeChecked();
  });

  it('reports the basemap that was pressed', async () => {
    const onBasemap = vi.fn();
    render(<BasemapToolView active="street" onBasemap={onBasemap} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Địa hình' }));
    expect(onBasemap).toHaveBeenCalledWith('dem');
  });
});

describe('BasemapTool', () => {
  it('issues a setBasemap command and shows the basemap in use', async () => {
    render(<BasemapTool />);
    expect(screen.getByRole('radio', { name: 'Đường phố' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Vệ tinh' }));
    expect(h.run).toHaveBeenCalledWith({ kind: 'setBasemap', basemap: 'satellite' });
  });
});
