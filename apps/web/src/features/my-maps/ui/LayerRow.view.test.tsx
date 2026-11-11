import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { layerKindLabel } from '../model/layerKindLabel';
import { LayerRowView } from './LayerRow.view';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', kind: 'catalogue' as const, title: 'Mưa giờ', kindLabel: 'Liên kết Danh mục', visible: true, opacity: 1,
  truncated: null, ...over,
});

describe('a catalogue link row', () => {
  it('is labelled "Liên kết Danh mục"', () => {
    expect(layerKindLabel({ kind: 'catalogue', fields: [], layerKey: null })).toBe('Liên kết Danh mục');
  });

  it('a link the reader cannot see says so, with no checkbox, opacity or table', () => {
    render(<LayerRowView layer={row({ gone: true })} onVisible={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.getByText('Không có quyền xem hoặc đã bị xoá')).toBeTruthy();
    expect(screen.getByText('Mưa giờ')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('the owner keeps the settings of a gone link, to remove it', () => {
    const onSettings = vi.fn();
    render(<LayerRowView layer={row({ gone: true })} onVisible={vi.fn()} onOpacity={vi.fn()} onSettings={onSettings} />);
    screen.getByRole('button', { name: 'Thiết lập lớp Mưa giờ' }).click();
    expect(onSettings).toHaveBeenCalled();
  });

  it('a visible link has its checkbox and opacity, and no truncation note', () => {
    render(<LayerRowView layer={row({ truncated: 5 })} onVisible={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Độ mờ Mưa giờ' })).toBeTruthy();
    expect(screen.queryByText(/Chỉ hiện/)).toBeNull();
    expect(screen.queryByText('Không có quyền xem hoặc đã bị xoá')).toBeNull();
  });
});
