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
  addValue: vi.fn(),
  patchValue: vi.fn(),
  previewStoredUnit: vi.fn(),
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
    {
      name: 'kind', source: 'column', valueType: 'code', label: 'Loại công trình', definition: 'Loại.', codeList: 'open',
      values: [{ code: 'hydro', name: 'Thuỷ điện', order: 1, colorHint: '#3366cc' }, { code: 'irrig', name: 'Thuỷ lợi', order: 2, retired: true }],
      validFrom: '2026-01-01',
    },
    {
      name: 'status', source: 'column', valueType: 'code', label: 'Trạng thái', definition: 'Trạng thái.', codeList: 'closed',
      values: [{ code: 'on', name: 'Đang chạy', order: 1 }], validFrom: '2026-01-01',
    },
  ],
};
vi.mock('./useDictionary', () => ({ useDictionary: (): Dictionary => ({ dams: LAYER }) }));

const entry = (label = 'Tên tiếng Anh'): RevisedFeatureType => ({
  ...LAYER,
  revision: 3,
  attributes: [
    { ...LAYER.attributes[0], label, revision: 5 }, { ...LAYER.attributes[1], revision: 2 },
    { ...LAYER.attributes[2], revision: 7 }, { ...LAYER.attributes[3], revision: 9 },
  ],
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

  describe('listed values', () => {
    it('an open list can add a value', async () => {
      api.addValue.mockResolvedValue({});
      mount();
      await userEvent.click(await screen.findByRole('button', { name: /Loại công trình/ }));
      const add = within(await screen.findByRole('form', { name: 'Thêm giá trị' }));
      expect(add.getByRole('button', { name: 'Thêm giá trị' })).toBeDisabled();
      await userEvent.type(add.getByLabelText('Mã'), 'wind');
      await userEvent.type(add.getByLabelText('Tên giá trị'), 'Điện gió');
      await userEvent.type(add.getByLabelText('Định nghĩa'), 'Tua bin gió.');
      await userEvent.click(add.getByRole('button', { name: 'Thêm giá trị' }));
      await waitFor(() => expect(api.addValue).toHaveBeenCalledWith('dams', 'kind', {
        expectedRevision: 7, code: 'wind', name: 'Điện gió', definition: 'Tua bin gió.',
      }));
    });

    it('an open list edits a value and retires it, each row named by its code', async () => {
      api.patchValue.mockResolvedValue({});
      mount();
      await userEvent.click(await screen.findByRole('button', { name: /Loại công trình/ }));
      const name = await screen.findByLabelText('Tên giá trị hydro');
      await userEvent.clear(name);
      await userEvent.type(name, 'Thuỷ điện lớn');
      await userEvent.click(screen.getByRole('button', { name: 'Lưu giá trị hydro' }));
      await waitFor(() => expect(api.patchValue).toHaveBeenCalledWith('dams', 'kind', 'hydro', { expectedRevision: 7, name: 'Thuỷ điện lớn' }));
      await userEvent.click(screen.getByRole('button', { name: 'Ngừng dùng giá trị hydro' }));
      await waitFor(() => expect(api.patchValue).toHaveBeenCalledWith('dams', 'kind', 'hydro', { expectedRevision: 7, retired: true }));
      expect(screen.getByRole('button', { name: 'Dùng lại giá trị irrig' })).toBeInTheDocument();
    });

    it("a closed list's codes cannot be added or retired", async () => {
      api.patchValue.mockResolvedValue({});
      mount();
      await userEvent.click(await screen.findByRole('button', { name: /Trạng thái/ }));
      expect(await screen.findByLabelText('Tên giá trị on')).not.toHaveAttribute('readonly');
      expect(screen.queryByRole('form', { name: 'Thêm giá trị' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Thêm giá trị' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Ngừng dùng giá trị/ })).toBeNull();
      const list = within(screen.getByRole('region', { name: 'Giá trị của Trạng thái' }));
      expect(list.getAllByText('theo cấu trúc dữ liệu').length).toBeGreaterThanOrEqual(2);
      await userEvent.type(screen.getByLabelText('Màu gợi ý giá trị on'), '#aabbcc');
      await userEvent.click(screen.getByRole('button', { name: 'Lưu giá trị on' }));
      await waitFor(() => expect(api.patchValue).toHaveBeenCalledWith('dams', 'status', 'on', { expectedRevision: 9, colorHint: '#aabbcc' }));
    });

    it('while one row save is pending, another row cannot save or retire', async () => {
      let finish: (v: unknown) => void = () => {};
      api.patchValue.mockReturnValue(new Promise((r) => { finish = r; }));
      mount();
      await userEvent.click(await screen.findByRole('button', { name: /Loại công trình/ }));
      await userEvent.type(await screen.findByLabelText('Tên giá trị hydro'), '!');
      await userEvent.type(screen.getByLabelText('Tên giá trị irrig'), '!');
      expect(screen.getByRole('button', { name: 'Lưu giá trị irrig' })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'Lưu giá trị hydro' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu giá trị irrig' })).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Dùng lại giá trị irrig' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Ngừng dùng giá trị hydro' })).toBeDisabled();
      finish({});
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu giá trị irrig' })).toBeEnabled());
      expect(api.patchValue).toHaveBeenCalledTimes(1);
    });

    it('a 409 on a value reloads and shows the message', async () => {
      api.addValue.mockRejectedValue(new ApiError(409, 'DICTIONARY_CHANGED', 'x'));
      mount();
      await userEvent.click(await screen.findByRole('button', { name: /Loại công trình/ }));
      const add = within(await screen.findByRole('form', { name: 'Thêm giá trị' }));
      await userEvent.type(add.getByLabelText('Mã'), 'wind');
      await userEvent.type(add.getByLabelText('Tên giá trị'), 'Gió');
      const before = api.fetchLayerEntry.mock.calls.length;
      await userEvent.click(add.getByRole('button', { name: 'Thêm giá trị' }));
      expect(await screen.findByText('Mục này vừa được người khác sửa.')).toBeInTheDocument();
      await waitFor(() => expect(api.fetchLayerEntry.mock.calls.length).toBeGreaterThan(before));
    });
  });

  describe('stored-unit correction', () => {
    const open = async () => {
      await userEvent.click(await screen.findByRole('button', { name: /Diện tích/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Hiệu chỉnh đơn vị lưu…' }));
      return within(await screen.findByRole('dialog', { name: 'Hiệu chỉnh đơn vị lưu' }));
    };

    it('the stored-unit dialog needs a preview, a date and the confirmation', async () => {
      api.previewStoredUnit.mockResolvedValue({ rows: [{ id: '1', stored: 12.5, before: '12,5 km²', after: '12,5 ha' }] });
      api.patchAttribute.mockResolvedValue({});
      mount();
      const dialog = await open();
      const apply = dialog.getByRole('button', { name: 'Áp dụng' });
      expect(apply).toBeDisabled();
      await userEvent.selectOptions(dialog.getByLabelText('Đơn vị lưu mới'), 'ha');
      await userEvent.click(dialog.getByRole('button', { name: 'Xem trước' }));
      expect(await dialog.findByText(/12,5 km² → 12,5 ha/)).toBeInTheDocument();
      expect(api.previewStoredUnit).toHaveBeenCalledWith('dams', 'area', 'ha');
      expect(apply).toBeDisabled();
      await userEvent.type(dialog.getByLabelText('Áp dụng từ ngày'), '2026-11-01');
      expect(apply).toBeDisabled();
      await userEvent.click(dialog.getByRole('checkbox', { name: 'Tôi hiểu việc này chỉ sửa cách hiểu số liệu, không đổi số liệu.' }));
      expect(apply).toBeEnabled();
      await userEvent.click(apply);
      await waitFor(() => expect(api.patchAttribute).toHaveBeenCalledWith('dams', 'area', {
        expectedRevision: 2, storedUnit: 'ha', storedUnitValidFrom: '2026-11-01',
      }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('changing the unit after a preview asks for a new preview', async () => {
      api.previewStoredUnit.mockResolvedValue({ rows: [] });
      mount();
      const dialog = await open();
      await userEvent.selectOptions(dialog.getByLabelText('Đơn vị lưu mới'), 'ha');
      await userEvent.click(dialog.getByRole('button', { name: 'Xem trước' }));
      expect(await dialog.findByText('Không có giá trị mẫu để xem trước.')).toBeInTheDocument();
      await userEvent.type(dialog.getByLabelText('Áp dụng từ ngày'), '2026-11-01');
      await userEvent.click(dialog.getByRole('checkbox'));
      expect(dialog.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
      await userEvent.selectOptions(dialog.getByLabelText('Đơn vị lưu mới'), 'm2');
      expect(dialog.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    });

    it('switching attribute closes the dialog and it reopens empty', async () => {
      api.previewStoredUnit.mockResolvedValue({ rows: [] });
      mount();
      let dialog = await open();
      await userEvent.selectOptions(dialog.getByLabelText('Đơn vị lưu mới'), 'ha');
      await userEvent.click(dialog.getByRole('button', { name: 'Xem trước' }));
      await dialog.findByText('Không có giá trị mẫu để xem trước.');
      await userEvent.type(dialog.getByLabelText('Áp dụng từ ngày'), '2026-11-01');
      await userEvent.click(dialog.getByRole('checkbox'));
      await userEvent.click(screen.getByRole('button', { name: /Tên tiếng Anh/ }));
      expect(screen.queryByRole('dialog')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /Diện tích/ }));
      expect(screen.queryByRole('dialog')).toBeNull();
      await userEvent.click(await screen.findByRole('button', { name: 'Hiệu chỉnh đơn vị lưu…' }));
      dialog = within(await screen.findByRole('dialog', { name: 'Hiệu chỉnh đơn vị lưu' }));
      expect(dialog.getByLabelText('Đơn vị lưu mới')).toHaveValue('km2');
      expect(dialog.getByLabelText('Áp dụng từ ngày')).toHaveValue('');
      expect(dialog.getByRole('checkbox')).not.toBeChecked();
      expect(dialog.queryByText('Không có giá trị mẫu để xem trước.')).toBeNull();
    });

    it('the stored-unit dialog offers only units of the same dimension', async () => {
      mount();
      const dialog = await open();
      const values = Array.from((dialog.getByLabelText('Đơn vị lưu mới') as HTMLSelectElement).options).map((o) => o.value);
      expect(values).toEqual(expect.arrayContaining(['km2', 'ha', 'm2']));
      expect(values).not.toContain('m');
      expect(values).not.toContain('mm');
    });

    it('a date error from the API shows under the date field', async () => {
      api.previewStoredUnit.mockResolvedValue({ rows: [] });
      api.patchAttribute.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Ngày quá sớm.', { field: 'storedUnitValidFrom' }));
      mount();
      const dialog = await open();
      await userEvent.selectOptions(dialog.getByLabelText('Đơn vị lưu mới'), 'ha');
      await userEvent.click(dialog.getByRole('button', { name: 'Xem trước' }));
      await dialog.findByText('Không có giá trị mẫu để xem trước.');
      await userEvent.type(dialog.getByLabelText('Áp dụng từ ngày'), '2020-01-01');
      await userEvent.click(dialog.getByRole('checkbox'));
      await userEvent.click(dialog.getByRole('button', { name: 'Áp dụng' }));
      expect(await dialog.findByText('Ngày quá sớm.')).toBeInTheDocument();
      expect(dialog.getByLabelText('Áp dụng từ ngày')).toHaveAttribute('aria-invalid', 'true');
    });
  });
});
