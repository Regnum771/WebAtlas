import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildUnitTree } from '@webatlas/shared';

const treeStatus = vi.hoisted(() => ({ status: 'ready' as 'loading' | 'error' | 'ready', retry: vi.fn() }));
vi.mock('../../../entities/session/model/useUnitTree', () => ({ useUnitTreeStatus: () => treeStatus }));

import { UnitPicker } from './UnitPicker';

const TREE = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '20001', level: 'ward', parent: '48', name: 'Điện Hồng' },
  { code: '20002', level: 'ward', parent: '48', name: 'Hải Châu' },
]);

describe('UnitPicker', () => {
  beforeEach(() => { treeStatus.status = 'ready'; treeStatus.retry.mockReset(); });

  it('says the unit tree failed to load, with Thử lại, instead of an empty list', async () => {
    treeStatus.status = 'error';
    render(<UnitPicker tree={null} selected={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách đơn vị hành chính.');
    expect(screen.queryByLabelText('Tìm đơn vị')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(treeStatus.retry).toHaveBeenCalledTimes(1);
  });

  it('search finds a xã by name without diacritics', async () => {
    render(<UnitPicker tree={TREE} selected={[]} onChange={vi.fn()} />);
    expect(screen.queryByText('Điện Hồng')).toBeNull();
    await userEvent.setup().type(screen.getByLabelText('Tìm đơn vị'), 'dien hong');
    expect(screen.getByText('Điện Hồng')).toBeInTheDocument();
    expect(screen.queryByText('Hải Châu')).toBeNull();
  });

  it('selecting Đà Nẵng then one of its xã keeps one unit', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<UnitPicker tree={TREE} selected={[]} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: /Đà Nẵng/ }));
    expect(onChange).toHaveBeenLastCalledWith(['48']);
    rerender(<UnitPicker tree={TREE} selected={['48']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Mở Đà Nẵng' }));
    expect(screen.getAllByText('Đã gồm trong Đà Nẵng')).toHaveLength(2);
    onChange.mockClear();
    await user.click(screen.getByRole('checkbox', { name: /Điện Hồng/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('single mode renders radios and picks one unit', async () => {
    const onChange = vi.fn();
    render(<UnitPicker tree={TREE} selected={[]} onChange={onChange} mode="single" />);
    await userEvent.setup().click(screen.getByRole('radio', { name: /Đà Nẵng/ }));
    expect(onChange).toHaveBeenCalledWith(['48']);
  });

  it('shows the field error', () => {
    render(<UnitPicker tree={TREE} selected={[]} onChange={vi.fn()} error="Đơn vị 99 không tồn tại." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Đơn vị 99 không tồn tại.');
  });

  it('shows the selected names and a remove button that emits the new selection', async () => {
    const onChange = vi.fn();
    render(<UnitPicker tree={TREE} selected={['48', '20001']} onChange={onChange} />);
    expect(screen.getByText(/Đã chọn:/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bỏ Điện Hồng' }));
    expect(onChange).toHaveBeenCalledWith(['48']);
  });

  it('editing a group whose units are wards shows them without expanding', () => {
    render(<UnitPicker tree={TREE} selected={['20001']} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /Điện Hồng/ })).toBeChecked();
  });
});
