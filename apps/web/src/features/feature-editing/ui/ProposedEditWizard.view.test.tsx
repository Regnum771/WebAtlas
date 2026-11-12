import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProposedEditWizardView, type ProposedEditWizardViewProps } from './ProposedEditWizard.view';

function props(over: Partial<ProposedEditWizardViewProps> = {}): ProposedEditWizardViewProps {
  return {
    title: 'Sông Hinh',
    columns: ['name', 'wattage_mw'],
    labels: { name: 'geographicalName', wattage_mw: 'ratedPower' },
    values: { name: 'Sông Hinh', wattage_mw: '72' },
    isChanged: (c) => c === 'wattage_mw',
    previous: (c) => (c === 'wattage_mw' ? '70' : 'Sông Hinh'),
    sourceDocument: '', sourceProvider: '',
    canSave: false, saving: false, error: null,
    onField: vi.fn(), onSourceDocument: vi.fn(), onSourceProvider: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
    ...over,
  };
}

describe('ProposedEditWizardView', () => {
  it('marks changed fields with their previous value', () => {
    render(<ProposedEditWizardView {...props()} />);
    expect(screen.getByText('Trước: 70')).toBeInTheDocument();
    expect(screen.queryByText('Trước: Sông Hinh')).toBeNull();
  });

  it('shows both required source fields and disables save until allowed', () => {
    render(<ProposedEditWizardView {...props()} />);
    expect(screen.getByLabelText('Tài liệu nguồn *')).toBeRequired();
    expect(screen.getByLabelText('Người cung cấp *')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('says Đang lưu on the save button while saving', () => {
    render(<ProposedEditWizardView {...props({ saving: true })} />);
    const save = screen.getByRole('button', { name: /Đang lưu/ });
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(save).toHaveTextContent(/^Đang lưu$/);
  });

  it('shows a second line under the error when there is one', () => {
    render(<ProposedEditWizardView {...props({ error: 'Đối tượng thuộc Đà Nẵng.', errorDetail: 'Thiếu quyền duyệt và xuất bản.' })} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Đối tượng thuộc Đà Nẵng.');
    expect(alert).toHaveTextContent('Thiếu quyền duyệt và xuất bản.');
  });

  it('cancels without saving', () => {
    const p = props();
    render(<ProposedEditWizardView {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onSubmit).not.toHaveBeenCalled();
  });
});
