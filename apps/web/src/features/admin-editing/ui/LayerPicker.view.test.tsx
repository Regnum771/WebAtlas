import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerPickerView } from './LayerPicker.view';

const layers = [
  { key: 'dams', geomType: 'Point' },
  { key: 'rivers', geomType: 'MultiLineString' },
];

describe('LayerPickerView', () => {
  it('renders exactly the provided editable layers and no base layers', () => {
    render(<LayerPickerView layers={layers} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('option', { name: /dams/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /rivers/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /provinces|wards/i })).not.toBeInTheDocument();
  });

  it('calls onSelect with the chosen key', async () => {
    const onSelect = vi.fn();
    render(<LayerPickerView layers={layers} selectedKey={null} onSelect={onSelect} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'rivers');
    expect(onSelect).toHaveBeenCalledWith('rivers');
  });
});
