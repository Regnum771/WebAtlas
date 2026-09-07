import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBoxView } from './SearchBox.view';

const hits = [
  { layerKey: 'dams' as const, featureId: 'd1', name: 'Thủy điện Ya Ly', lonLat: [108.0, 14.2] as [number, number] },
  { layerKey: 'lakes' as const, featureId: 'l1', name: 'Hồ Lắk', lonLat: [108.2, 12.4] as [number, number] },
];

describe('SearchBoxView', () => {
  it('renders the input with its placeholder', () => {
    render(<SearchBoxView query="" results={[]} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByPlaceholderText('Tìm kiếm đối tượng…')).toBeInTheDocument();
  });

  it('renders each result name', () => {
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('Thủy điện Ya Ly')).toBeInTheDocument();
    expect(screen.getByText('Hồ Lắk')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked hit', async () => {
    const onSelect = vi.fn();
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Hồ Lắk'));
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
  });

  it('forwards typing to onQuery', async () => {
    const onQuery = vi.fn();
    render(<SearchBoxView query="" results={[]} loading={false} onQuery={onQuery} onSelect={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('Tìm kiếm đối tượng…'), 'h');
    expect(onQuery).toHaveBeenCalledWith('h');
  });
});
