import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { OperatorOption } from '../model/useTablePresenter';
import { LayerTableView } from './LayerTable.view';

type Props = ComponentProps<typeof LayerTableView>;

const NUMBER_OPS: OperatorOption[] = [
  { op: 'eq', label: 'bằng' }, { op: 'neq', label: 'khác' }, { op: 'lt', label: '<' }, { op: 'lte', label: '≤' },
  { op: 'gt', label: '>' }, { op: 'gte', label: '≥' }, { op: 'empty', label: 'trống' }, { op: 'notEmpty', label: 'không trống' },
];
const TEXT_OPS: OperatorOption[] = [
  { op: 'contains', label: 'chứa' }, { op: 'eq', label: 'bằng' }, { op: 'neq', label: 'khác' },
  { op: 'empty', label: 'trống' }, { op: 'notEmpty', label: 'không trống' },
];

function props(over: Partial<Props> = {}): Props {
  return {
    title: 'Đập thủy điện',
    total: 151,
    matched: 12,
    q: '',
    conditions: [
      { field: 'cong_suat', fieldLabel: 'cong_suat', op: 'gt', opLabel: '>', value: '50', needsValue: true, type: 'number', ops: NUMBER_OPS },
      { field: 'ten', fieldLabel: 'ten', op: 'empty', opLabel: 'trống', value: '', needsValue: false, type: 'text', ops: TEXT_OPS },
    ],
    fields: [
      { name: 'ten', label: 'ten', type: 'text' },
      { name: 'cong_suat', label: 'cong_suat', type: 'number' },
    ],
    canAddCondition: true,
    match: 'all',
    inView: false,
    columns: [
      { name: 'ten', label: 'ten', type: 'text' },
      { name: 'cong_suat', label: 'cong_suat', type: 'number' },
    ],
    rows: [
      { id: '1', symbol: 'data:image/png;base64,A', cells: ['Đập A', '60'], properties: {}, bbox: null },
      { id: '2', symbol: 'data:image/png;base64,B', cells: ['Đập B', '75'], properties: {}, bbox: null },
    ],
    sort: { field: 'cong_suat', dir: 'desc' },
    page: { index: 0, size: 100, from: 1, to: 12, canPrev: false, canNext: false },
    loading: false,
    error: null,
    onSearch: vi.fn(),
    onAddCondition: vi.fn(),
    onUpdateCondition: vi.fn(),
    onRemoveCondition: vi.fn(),
    onMatch: vi.fn(),
    onInView: vi.fn(),
    onSort: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onClose: vi.fn(),
    selectedId: null,
    selectedOutsideFilter: false,
    canZoom: true,
    onSelectRow: vi.fn(),
    onZoom: vi.fn(),
    ...over,
  };
}

describe('LayerTableView', () => {
  it('shows the header counts, the chips and the paging line', async () => {
    const p = props();
    const { container } = render(<LayerTableView {...p} />);
    expect(screen.getByText('Đập thủy điện')).toBeInTheDocument();
    expect(screen.getByText('151 đối tượng · 12 khớp')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tìm…')).toBeInTheDocument();

    // Chips read `{field} {opLabel} {value}`; ✕ removes one.
    expect(screen.getByRole('button', { name: 'cong_suat > 50' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ten trống' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ điều kiện cong_suat > 50' }));
    expect(p.onRemoveCondition).toHaveBeenCalledWith(0);
    expect(screen.getByRole('button', { name: '+ Thêm điều kiện' })).toBeEnabled();
    const match = screen.getByRole('combobox', { name: 'Cách nối điều kiện' });
    expect(within(match).getAllByRole('option').map((o) => o.textContent)).toEqual(['Tất cả điều kiện', 'Một trong các điều kiện']);
    expect(screen.getByRole('checkbox', { name: 'Chỉ trong khung nhìn' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();

    // The columns: the symbol first, then each field; the sorted one shows its direction.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Ký hiệu', 'ten', 'cong_suat ▼']);
    expect(screen.getByRole('columnheader', { name: 'cong_suat' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: 'ten' })).not.toHaveAttribute('aria-sort');
    await userEvent.click(screen.getByRole('button', { name: 'ten' }));
    expect(p.onSort).toHaveBeenCalledWith('ten');
    const symbols = container.querySelectorAll('tbody img');
    expect([...symbols].map((img) => [img.getAttribute('src'), img.getAttribute('alt')])).toEqual([
      ['data:image/png;base64,A', ''], ['data:image/png;base64,B', ''],
    ]);
    expect(screen.getByRole('cell', { name: 'Đập B' })).toBeInTheDocument();

    expect(screen.getByText('1–12 / 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trước' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sau' })).toBeDisabled();
  });

  it('a chip opens its editor with the operators it offers; + Thêm điều kiện adds one', async () => {
    const p = props();
    const { rerender } = render(<LayerTableView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'cong_suat > 50' }));
    const editor = screen.getByRole('group', { name: 'Điều kiện' });
    const op = within(editor).getByRole('combobox', { name: 'Phép so sánh' });
    expect(within(op).getAllByRole('option').map((o) => o.textContent)).toEqual(['bằng', 'khác', '<', '≤', '>', '≥', 'trống', 'không trống']);
    await userEvent.selectOptions(op, 'lte');
    expect(p.onUpdateCondition).toHaveBeenCalledWith(0, { op: 'lte' });
    await userEvent.type(within(editor).getByRole('textbox', { name: 'Giá trị' }), '1');
    expect(p.onUpdateCondition).toHaveBeenCalledWith(0, { value: '501' });
    await userEvent.selectOptions(within(editor).getByRole('combobox', { name: 'Trường' }), 'ten');
    expect(p.onUpdateCondition).toHaveBeenCalledWith(0, { field: 'ten' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Điều kiện' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '+ Thêm điều kiện' }));
    expect(p.onAddCondition).toHaveBeenCalled();
    rerender(<LayerTableView {...p} conditions={[...p.conditions, { ...p.conditions[1], op: 'contains', opLabel: 'chứa', needsValue: true }]} />);
    // The new condition's editor is open, its value box ready.
    expect(within(screen.getByRole('group', { name: 'Điều kiện' })).getByRole('textbox', { name: 'Giá trị' })).toHaveValue('');
  });

  it('a row click selects it; the selected row is marked; Phóng tới zooms', async () => {
    const p = props({ selectedId: '2' });
    render(<LayerTableView {...p} />);
    const rowOf = (name: string) => screen.getByRole('cell', { name }).closest('tr')!;
    expect(rowOf('Đập B')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('Đập A')).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(screen.getByRole('cell', { name: 'Đập A' }));
    expect(p.onSelectRow).toHaveBeenCalledWith('1');
    // From the keyboard too.
    rowOf('Đập A').focus();
    await userEvent.keyboard('{Enter}');
    expect(p.onSelectRow).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Phóng tới' }));
    expect(p.onZoom).toHaveBeenCalled();
    expect(screen.queryByText('Đối tượng này không khớp bộ lọc')).toBeNull();
  });

  it('a selection the filter hides shows the note above the rows; Phóng tới can be off', () => {
    const { container } = render(<LayerTableView {...props({ selectedId: '9', selectedOutsideFilter: true, canZoom: false })} />);
    const note = screen.getByText('Đối tượng này không khớp bộ lọc');
    const table = container.querySelector('table')!;
    // The note comes before the rows.
    expect(note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Phóng tới' })).toBeDisabled();
  });

  it('loading keeps the rows faded; a network error offers Thử lại', async () => {
    const onRetry = vi.fn();
    const { container, rerender } = render(<LayerTableView {...props({ loading: true })} />);
    expect(container.querySelector('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('cell', { name: 'Đập A' })).toBeInTheDocument();
    rerender(<LayerTableView {...props({ error: 'Không tải được bảng. Thử lại.', onRetry })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được bảng. Thử lại.');
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<LayerTableView {...props({ error: 'Trường "x" không có trong lớp này.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Trường "x" không có trong lớp này.');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });
});
