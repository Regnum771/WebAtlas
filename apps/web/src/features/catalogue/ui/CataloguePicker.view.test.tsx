import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CataloguePickerView, type CataloguePickerViewProps } from './CataloguePicker.view';
import type { CatalogueItem } from '../api/catalogue.api';

const item = (id: string, over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id, kind: 'vector', title: `Lớp ${id}`, abstract: '', managingUnit: 'Sở TNMT', isPublished: true, mine: false,
  variable: null, unit: null, timeSteps: null, bbox4326: null, layerName: `geonode:${id}`, updatedAt: '2026-11-12T00:00:00Z', ...over,
});

const base = (over: Partial<CataloguePickerViewProps> = {}): CataloguePickerViewProps => ({
  query: '', kind: '', status: 'ok', items: [], total: 0, page: 1, pageSize: 20, addedIds: new Set(), canUpload: false,
  onQuery: vi.fn(), onKind: vi.fn(), onSearch: vi.fn(), onPage: vi.fn(), onAdd: vi.fn(), onUpload: vi.fn(), ...over,
});

describe('CataloguePickerView', () => {
  it('shows "Chưa duyệt" only on the uploader own unpublished entries', () => {
    render(<CataloguePickerView {...base({
      items: [item('a', { mine: true, isPublished: false }), item('b', { mine: true, isPublished: true }), item('c')],
      total: 3,
    })} />);
    expect(screen.getAllByText('Chưa duyệt')).toHaveLength(1);
  });

  it('says so when nothing matches', () => {
    render(<CataloguePickerView {...base()} />);
    expect(screen.getByText('Không có dữ liệu phù hợp.')).toBeInTheDocument();
  });

  it('shows the connection error', () => {
    render(<CataloguePickerView {...base({ status: 'error' })} />);
    expect(screen.getByText('Không kết nối được Danh mục.')).toBeInTheDocument();
  });

  it('adds an item and marks an added one', async () => {
    const onAdd = vi.fn();
    const a = item('a');
    render(<CataloguePickerView {...base({ items: [a, item('b')], total: 2, addedIds: new Set(['b']), onAdd })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vào bản đồ: Lớp a' }));
    expect(onAdd).toHaveBeenCalledWith(a);
    expect(screen.getByText('Đã thêm')).toBeInTheDocument();
  });

  it('offers the upload only to a signed-in user', async () => {
    const onUpload = vi.fn();
    const { rerender } = render(<CataloguePickerView {...base()} />);
    expect(screen.queryByRole('button', { name: 'Tải chuỗi thời gian lên' })).toBeNull();
    rerender(<CataloguePickerView {...base({ canUpload: true, onUpload })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tải chuỗi thời gian lên' }));
    expect(onUpload).toHaveBeenCalled();
  });
});
