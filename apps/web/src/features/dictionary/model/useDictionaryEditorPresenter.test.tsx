import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Dictionary, DictFeatureType } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { useDictionaryEditorPresenter } from './useDictionaryEditorPresenter';
import { DictionaryEditorView } from '../ui/DictionaryEditor.view';
import { DictionaryHistoryView } from '../ui/DictionaryHistory.view';
import type { HistoryEntry, RevisedFeatureType } from '../api/dictionaryEdit.api';

const api = vi.hoisted(() => ({
  fetchLayerEntry: vi.fn(),
  fetchHistory: vi.fn(),
  patchLayer: vi.fn(),
  patchAttribute: vi.fn(),
  restoreFields: vi.fn(),
}));
vi.mock('../api/dictionaryEdit.api', () => api);

const LAYER: DictFeatureType = {
  key: 'dams', kind: 'vector', name: 'Đập & Hồ chứa', definition: 'Đập và hồ chứa.', table: 'water.dams', crs: 4326,
  geometryType: 'Point', geometryMeaning: 'representativePoint', validFrom: '2026-01-01',
  attributes: [
    { name: 'name_en', source: 'column', valueType: 'text', label: 'Tên tiếng Anh', definition: 'Tên không dấu.', validFrom: '2026-01-01' },
    {
      name: 'area', source: 'column', valueType: 'number', label: 'Diện tích', definition: 'Diện tích mặt nước.',
      storedUnit: 'km2', displayUnits: ['km2', 'ha'], displayUnit: 'km2', precision: 1, validFrom: '2026-01-01',
    },
  ],
};
vi.mock('./useDictionary', () => ({ useDictionary: (): Dictionary => ({ dams: LAYER }) }));

const entry = (label = 'Tên tiếng Anh'): RevisedFeatureType => ({
  ...LAYER,
  revision: 3,
  attributes: [{ ...LAYER.attributes[0], label, revision: 5 }, { ...LAYER.attributes[1], revision: 2 }],
} as RevisedFeatureType);

const row = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: 1, featureType: 'dams', attribute: 'name_en', code: null, field: 'label', oldValue: 'Tên tiếng Anh', newValue: 'Sửa',
  reason: 'edit', changedBy: { id: 'u1', name: 'Lan' }, changedAt: '2026-10-25T03:00:00.000Z', ...over,
});

let client: QueryClient;
function Harness() {
  const p = useDictionaryEditorPresenter();
  return (
    <>
      <DictionaryEditorView {...p.editor} />
      <DictionaryHistoryView {...p.history} />
    </>
  );
}
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
};

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.fetchLayerEntry.mockResolvedValue(entry());
  api.fetchHistory.mockResolvedValue([]);
});

describe('dictionary editor', () => {
  it('locked fields are read-only with the structure hint', async () => {
    mount();
    const crs = await screen.findByLabelText('Hệ toạ độ');
    expect(crs).toHaveAttribute('readonly');
    expect(screen.getAllByText('theo cấu trúc dữ liệu').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Tên lớp')).not.toHaveAttribute('readonly');
  });

  it('saving a label sends the expected revision and refreshes the dictionary', async () => {
    api.patchAttribute.mockResolvedValue(entry().attributes[0]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Tên tiếng Anh/ }));
    const label = await screen.findByLabelText('Nhãn');
    await userEvent.clear(label);
    await userEvent.type(label, 'English name');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.patchAttribute).toHaveBeenCalledWith('dams', 'name_en', { expectedRevision: 5, label: 'English name' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dictionary'] }));
  });

  it('a 409 reloads the entry and shows the message', async () => {
    api.patchAttribute.mockRejectedValue(new ApiError(409, 'DICTIONARY_CHANGED', 'x'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Tên tiếng Anh/ }));
    const label = await screen.findByLabelText('Nhãn');
    await userEvent.type(label, '!');
    const before = api.fetchLayerEntry.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Mục này vừa được người khác sửa.')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchLayerEntry.mock.calls.length).toBeGreaterThan(before));
  });

  it('a 400 shows the API message under its field', async () => {
    api.patchAttribute.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Trường "Số chữ số thập phân" phải là số nguyên từ 0 đến 6.', { field: 'precision' }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Diện tích/ }));
    const precision = await screen.findByLabelText('Số chữ số thập phân');
    await userEvent.clear(precision);
    await userEvent.type(precision, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Trường "Số chữ số thập phân" phải là số nguyên từ 0 đến 6.')).toBeInTheDocument();
    expect(precision).toHaveAttribute('aria-invalid', 'true');
  });

  it('restore sends the field and shows the default again', async () => {
    api.fetchLayerEntry.mockResolvedValue(entry('Sửa'));
    api.fetchHistory.mockResolvedValue([row({})]);
    api.restoreFields.mockResolvedValue(entry().attributes[0]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Sửa/ }));
    expect(await screen.findByText(/Đã sửa bởi Lan lúc/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nhãn')).toHaveValue('Sửa');
    api.fetchLayerEntry.mockResolvedValue(entry());
    api.fetchHistory.mockResolvedValue([row({ id: 2, reason: 'restore', oldValue: 'Sửa', newValue: 'Tên tiếng Anh' }), row({})]);
    await userEvent.click(screen.getByRole('button', { name: 'Khôi phục mặc định' }));
    await waitFor(() => expect(api.restoreFields).toHaveBeenCalledWith('dams', 'name_en', ['label']));
    await waitFor(() => expect(screen.getByLabelText('Nhãn')).toHaveValue('Tên tiếng Anh'));
    expect(screen.queryByText(/Đã sửa bởi/)).toBeNull();
  });

  it('a retire date is sent as validTo', async () => {
    api.patchAttribute.mockResolvedValue(entry().attributes[0]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Tên tiếng Anh/ }));
    const date = await screen.findByLabelText('Ngừng dùng từ');
    await userEvent.type(date, '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.patchAttribute).toHaveBeenCalledWith('dams', 'name_en', { expectedRevision: 5, validTo: '2026-12-31' }));
  });
});
