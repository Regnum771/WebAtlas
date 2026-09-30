import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Availability, RoiTool } from '../../roi/model/toolAvailability';
import { AnalysisButtonsView } from './AnalysisButtons.view';

const all = (a: Availability) => ({ select_within: a, zonal_elevation: a, elevation_profile: a, nearest: a }) as Record<RoiTool, Availability>;

describe('AnalysisButtonsView', () => {
  it('groups the tools as Vùng · Tuyến · Lân cận, with no Vùng đệm', () => {
    render(<AnalysisButtonsView active={null} availability={all({ enabled: true })} onOpen={vi.fn()} />);
    expect(within(screen.getByRole('group', { name: 'Vùng' })).getAllByRole('button')).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: 'Tuyến' })).getByRole('button', { name: 'Trắc diện độ cao' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Lân cận' })).getByRole('button', { name: 'Gần nhất' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vùng đệm' })).toBeNull();
  });

  it('keeps a disabled tool focusable and pressable, with its reason in the tooltip', async () => {
    const onOpen = vi.fn();
    render(<AnalysisButtonsView active={null} availability={all({ enabled: false, reason: 'Chưa có vùng phân tích' })} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Gần nhất' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('title', 'Gần nhất — Chưa có vùng phân tích');
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith('nearest');
  });
});
