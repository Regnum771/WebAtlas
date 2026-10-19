import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildUnitTree, type UnitNode } from '@webatlas/shared';

const treeStatus = vi.hoisted(() => ({ status: 'ready' as 'loading' | 'error' | 'ready', retry: vi.fn() }));
vi.mock('../../../entities/session/model/useUnitTree', () => ({ useUnitTreeStatus: () => treeStatus }));

import { ManagingUnitFieldView } from './ManagingUnitField.view';
import type { ManagingUnitFieldState } from '../model/useManagingUnitField';

const UNITS: UnitNode[] = [
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '51', level: 'province', parent: 'VN', name: 'Quảng Ngãi' },
];
const tree = buildUnitTree(UNITS);
const field = (over: Partial<ManagingUnitFieldState> = {}): ManagingUnitFieldState => ({
  value: '', setValue: vi.fn(), options: [UNITS[1]], allowed: (c) => c === '48', tree,
  suggestion: null, error: null, hint: null, readOnlyText: null, locked: false, submittable: null, ...over,
});

describe('ManagingUnitFieldView', () => {
  it('picks an allowed unit and disables the others', async () => {
    const f = field();
    render(<ManagingUnitFieldView field={f} />);
    expect(screen.getByRole('radio', { name: /Quảng Ngãi/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Đà Nẵng/ }));
    expect(f.setValue).toHaveBeenCalledWith('48');
  });

  it('shows the read-only text instead of a picker', () => {
    render(<ManagingUnitFieldView field={field({ readOnlyText: 'Quảng Ngãi — ngoài phạm vi của anh/chị' })} />);
    expect(screen.getByText('Quảng Ngãi — ngoài phạm vi của anh/chị')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('says the unit tree failed to load, with Thử lại', async () => {
    treeStatus.status = 'error';
    render(<ManagingUnitFieldView field={field({ tree: null, options: [] })} />);
    expect(screen.getByText('Không tải được danh sách đơn vị hành chính.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(treeStatus.retry).toHaveBeenCalledTimes(1);
    treeStatus.status = 'ready';
  });

  it('shows the field error and the hint', () => {
    render(<ManagingUnitFieldView field={field({ error: 'lỗi A', hint: 'gợi ý B' })} />);
    expect(screen.getByText('lỗi A')).toBeInTheDocument();
    expect(screen.getByText('gợi ý B')).toBeInTheDocument();
  });
});
