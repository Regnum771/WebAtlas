import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttributeFormView } from './AttributeForm.view';

const baseProps = {
  attributes: ['name', 'status'],
  labels: { name: 'geographicalName', status: 'operationalStatus' },
  values: { name: '', status: '' },
  fieldErrors: {} as Record<string, string>,
  error: null as string | null,
  canSave: true,
  saving: false,
  onField: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

describe('AttributeFormView', () => {
  it('renders one field per attribute with ISO labels', () => {
    render(<AttributeFormView {...baseProps} />);
    expect(screen.getByLabelText('geographicalName')).toBeInTheDocument();
    expect(screen.getByLabelText('operationalStatus')).toBeInTheDocument();
  });

  it('disables save when canSave is false', () => {
    render(<AttributeFormView {...baseProps} canSave={false} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls onSubmit when the form is submitted', async () => {
    const onSubmit = vi.fn();
    render(<AttributeFormView {...baseProps} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('shows a form-level error', () => {
    render(<AttributeFormView {...baseProps} error="Invalid geometry — please redraw" />);
    expect(screen.getByText('Invalid geometry — please redraw')).toBeInTheDocument();
  });
});
