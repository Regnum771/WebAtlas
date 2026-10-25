import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  const attributeForm = (name: string) => screen.getByRole('form', { name });

  it('locked fields are read-only with the structure hint', async () => {
    mount();
    const crs = await screen.findByLabelText('Hệ toạ độ');
    expect(crs).toHaveAttribute('readonly');
    expect(screen.getAllByText('theo cấu trúc dữ liệu').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Tên lớp')).not.toHaveAttribute('readonly');
  });

  it('the feature-type form sits above the attribute list', async () => {
    mount();
    const layerForm = await screen.findByRole('form', { name: 'Thông tin lớp' });
    const list = screen.getByRole('navigation', { name: 'Thuộc tính' });
    expect(layerForm.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thông tin lớp' })).toBeNull();
  });

  it('saving a label sends the expected revision and refreshes the dictionary', async () => {
    api.patchAttribute.mockResolvedValue(entry().attributes[0]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Tên tiếng Anh/ }));
    const form = within(attributeForm('Tên tiếng Anh'));
    const label = form.getByLabelText('Nhãn');
    await userEvent.clear(label);
    await userEvent.type(label, 'English name');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(form.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.patchAttribute).toHaveBeenCalledWith('dams', 'name_en', { expectedRevision: 5, label: 'English name' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dictionary'] }));
  });

  it('a 409 reloads the entry and shows the message', async () => {
    api.patchAttribute.mockRejectedValue(new ApiError(409, 'DICTIONARY_CHANGED', 'x'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Tên tiếng Anh/ }));
    const form = within(attributeForm('Tên tiếng Anh'));
    await userEvent.type(form.getByLabelText('Nhãn'), '!');
    const before = api.fetchLayerEntry.mock.calls.length;
    await userEvent.click(form.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Mục này vừa được người khác sửa.')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchLayerEntry.mock.calls.length).toBeGreaterThan(before));
  });

  it('a 400 shows the API message under its field', async () => {
    api.patchAttribute.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Trường "Số chữ số thập phân" phải là số nguyên từ 0 đến 6.', { field: 'precision' }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Diện tích/ }));
    const form = within(attributeForm('Diện tích'));
    const precision = form.getByLabelText('Số chữ số thập phân');
    expect(precision).toHaveAttribute('min', '0');
    expect(precision).toHaveAttribute('max', '6');
    expect(precision).toHaveAttribute('step', '1');
    await userEvent.clear(precision);
    await userEvent.type(precision, '3');
    await userEvent.click(form.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Trường "Số chữ số thập phân" phải là số nguyên từ 0 đến 6.')).toBeInTheDocument();
    expect(precision).toHaveAttribute('aria-invalid', 'true');
  });

  it('restore sends the field and shows the default again', async () => {
    api.fetchLayerEntry.mockResolvedValue(entry('Sửa'));
    api.fetchHistory.mockResolvedValue([row({})]);
    api.restoreFields.mockResolvedValue(entry().attributes[0]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Sửa/ }));
    const form = within(attributeForm('Sửa'));
    expect(await form.findByText(/Đã sửa bởi Lan lúc/)).toBeInTheDocument();
    expect(form.getByLabelText('Nhãn')).toHaveValue('Sửa');
    api.fetchLayerEntry.mockResolvedValue(entry());
    api.fetchHistory.mockResolvedValue([row({ id: 2, reason: 'restore', oldValue: 'Sửa', newValue: 'Tên tiếng Anh' }), row({})]);
    await userEvent.click(form.getByRole('button', { name: 'Khôi phục mặc định' }));
    await waitFor(() => expect(api.restoreFields).toHaveBeenCalledWith('dams', 'name_en', ['label']));
    await waitFor(() => expect(within(attributeForm('Tên tiếng Anh')).getByLabelText('Nhãn')).toHaveValue('Tên tiếng Anh'));
    expect(screen.queryByText(/Đã sửa bởi/)).toBeNull();
  });

  it('a retire date is sent as validTo', async () => {
    api.patchAttribute.mockResolvedValue(entry().attributes[0]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Tên tiếng Anh/ }));
    const form = within(attributeForm('Tên tiếng Anh'));
    await userEvent.type(form.getByLabelText('Ngừng dùng từ'), '2026-12-31');
    await userEvent.click(form.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.patchAttribute).toHaveBeenCalledWith('dams', 'name_en', { expectedRevision: 5, validTo: '2026-12-31' }));
  });

  it('unticking the shown display unit moves the shown unit to a permitted one', async () => {
    api.patchAttribute.mockResolvedValue(entry().attributes[1]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Diện tích/ }));
    const form = within(attributeForm('Diện tích'));
    expect(form.getByLabelText('Đơn vị hiển thị')).toHaveValue('km2');
    // km² is shown; remove it from the permitted units.
    await userEvent.click(form.getByRole('checkbox', { name: 'km²' }));
    expect(form.getByLabelText('Đơn vị hiển thị')).toHaveValue('ha');
    await userEvent.click(form.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.patchAttribute).toHaveBeenCalledWith(
      'dams', 'area', { expectedRevision: 2, displayUnit: 'ha', displayUnits: ['ha'] },
    ));
  });

  it('an attribute reads its own scoped history; the feature-type form reads the layer query', async () => {
    mount();
    await screen.findByRole('form', { name: 'Thông tin lớp' });
    expect(api.fetchHistory).toHaveBeenCalledWith('dams', null, 200);
    expect(api.fetchHistory).not.toHaveBeenCalledWith('dams', 'name_en', 200);
    await userEvent.click(screen.getByRole('button', { name: /Tên tiếng Anh/ }));
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('dams', 'name_en', 200));
  });

  it('feature-type badges use only the layer rows without an attribute', async () => {
    api.fetchHistory.mockResolvedValue([row({ attribute: null, field: 'name' }), row({ id: 2 })]);
    mount();
    const layerForm = within(await screen.findByRole('form', { name: 'Thông tin lớp' }));
    expect(await layerForm.findAllByText(/Đã sửa bởi Lan lúc/)).toHaveLength(1);
  });

  it('the history panel says when older entries are not shown', async () => {
    api.fetchHistory.mockResolvedValue(Array.from({ length: 200 }, (_, i) => row({ id: i + 1 })));
    mount();
    expect(await screen.findByText('Chỉ hiện 200 thay đổi gần nhất.')).toBeInTheDocument();
  });

  it('no notice below the limit, and raw reasons render in Vietnamese', async () => {
    api.fetchHistory.mockResolvedValue([
      row({ id: 1, attribute: null, reason: 'edit' }),
      row({ id: 2, attribute: null, reason: 'restore' }),
      row({ id: 3, attribute: null, reason: 'sync_revert', changedBy: null }),
      row({ id: 4, attribute: null, reason: 'sync_retire', changedBy: null }),
    ]);
    mount();
    const panel = within(await screen.findByRole('region', { name: 'Lịch sử thay đổi' }));
    for (const r of ['sửa', 'khôi phục', 'đồng bộ hoàn nguyên', 'đồng bộ ngừng dùng']) {
      expect(await panel.findByText(r)).toBeInTheDocument();
    }
    expect(panel.queryByText('Chỉ hiện 200 thay đổi gần nhất.')).toBeNull();
  });
});
