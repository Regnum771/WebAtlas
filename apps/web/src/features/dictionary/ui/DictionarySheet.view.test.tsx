import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DictionarySheetView } from './DictionarySheet.view';

const rows = [
  { name: 'a', label: 'Công suất', unitSymbol: 'MW', definition: 'Công suất lắp máy.' },
  { name: 'b', label: 'Trạng thái', definition: 'Tình trạng vận hành.', valueCount: 3 },
];

function setup(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <DictionarySheetView title="Đập — thuộc tính" dictionaryKey="dams" rows={rows} onClose={onClose} />
    </MemoryRouter>
  );
  return onClose;
}

describe('DictionarySheetView', () => {
  it('the sheet lists label, unit, definition and value count in order', () => {
    setup();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Công suất');
    expect(items[0]).toHaveTextContent('MW');
    expect(items[0]).toHaveTextContent('Công suất lắp máy.');
    expect(items[1]).toHaveTextContent('3 giá trị');
    expect(items[0]).not.toHaveTextContent('giá trị');
    expect(screen.getByRole('region', { name: 'Đập — thuộc tính' })).toBeInTheDocument();
  });

  it('Xem đầy đủ links to the layer page', () => {
    setup();
    expect(screen.getByRole('link', { name: 'Xem đầy đủ →' })).toHaveAttribute('href', '/du-lieu/dams');
  });

  it('Đóng calls onClose', async () => {
    const onClose = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalled();
  });
});
