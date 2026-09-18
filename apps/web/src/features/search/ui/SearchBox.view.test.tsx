import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    // Accessible name aggregates the badge chip + the displayed name.
    expect(screen.getByRole('button', { name: 'Đập Thủy điện Ya Ly' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hồ Lắk' })).toBeInTheDocument();
  });

  it('does not double the layer word when the feature name already starts with it', () => {
    const riverHit = { layerKey: 'rivers' as const, featureId: 'r1', name: 'Sông Srêpốk', lonLat: [108.1, 12.9] as [number, number] };
    render(<SearchBoxView query="srêpốk" results={[riverHit]} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);

    // Accessible name aggregates the badge chip + displayed name text; it must
    // read as the plain feature name, not "Sông Sông Srêpốk".
    const button = screen.getByRole('button', { name: 'Sông Srêpốk' });
    expect(button).toBeInTheDocument();
    // The badge chip is still rendered on its own, so the layer is still shown.
    expect(screen.getByText('Sông')).toBeInTheDocument();
    // The name span must not repeat "Sông" — only the badge carries it.
    expect(screen.queryByText('Sông Srêpốk')).not.toBeInTheDocument();
    expect(screen.getByText('Srêpốk')).toBeInTheDocument();
  });

  it('leaves names that do not start with the badge word untouched', () => {
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('Đập')).toBeInTheDocument();
    expect(screen.getByText('Thủy điện Ya Ly')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked hit', async () => {
    const onSelect = vi.fn();
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hồ Lắk' }));
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
  });

  it('forwards typing to onQuery', async () => {
    const onQuery = vi.fn();
    render(<SearchBoxView query="" results={[]} loading={false} onQuery={onQuery} onSelect={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('Tìm kiếm đối tượng…'), 'h');
    expect(onQuery).toHaveBeenCalledWith('h');
  });

  it('closes the dropdown on blur (clicking elsewhere on the map, tabbing away)', () => {
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Hồ Lắk' })).toBeInTheDocument();

    fireEvent.blur(screen.getByPlaceholderText('Tìm kiếm đối tượng…'));

    expect(screen.queryByRole('button', { name: 'Hồ Lắk' })).not.toBeInTheDocument();
  });

  it('closes the dropdown on Escape', () => {
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Hồ Lắk' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText('Tìm kiếm đối tượng…'), { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Hồ Lắk' })).not.toBeInTheDocument();
  });

  it('reopens on a fresh results set even after a prior dismissal', () => {
    const { rerender } = render(
      <SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />
    );
    fireEvent.blur(screen.getByPlaceholderText('Tìm kiếm đối tượng…'));
    expect(screen.queryByRole('button', { name: 'Hồ Lắk' })).not.toBeInTheDocument();

    const moreHits = [...hits, { layerKey: 'rivers' as const, featureId: 'r1', name: 'Sông Thu Bồn', lonLat: [108.3, 15.8] as [number, number] }];
    rerender(<SearchBoxView query="thu" results={moreHits} loading={false} onQuery={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Sông Thu Bồn' })).toBeInTheDocument();
  });

  it('does not close on a mousedown inside the results list (so a result click still registers)', async () => {
    const onSelect = vi.fn();
    render(<SearchBoxView query="th" results={hits} loading={false} onQuery={vi.fn()} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hồ Lắk' }));
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
  });
});
