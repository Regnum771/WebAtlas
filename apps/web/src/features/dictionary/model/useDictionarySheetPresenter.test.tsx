import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DICTIONARY, type Dictionary } from '@webatlas/shared';
import { useDictionarySheetPresenter } from './useDictionarySheetPresenter';
import { DictionarySheetView } from '../ui/DictionarySheet.view';
import { LayersPanelView } from '../../layers-panel/ui/LayersPanel.view';

let dictionary: Dictionary = DICTIONARY;
vi.mock('./useDictionary', () => ({ useDictionary: () => dictionary }));

describe('useDictionarySheetPresenter', () => {
  it('lists current attributes only', () => {
    const dams = DICTIONARY.dams;
    const [first, second, ...rest] = dams.attributes;
    dictionary = {
      ...DICTIONARY,
      dams: { ...dams, attributes: [first, { ...second, validTo: '2000-01-01' }, ...rest] },
    };
    const { result } = renderHook(() => useDictionarySheetPresenter());
    act(() => result.current.openSheet('layer_dams', 'Đập'));
    const names = result.current.sheet!.rows.map((r) => r.name);
    expect(names).toContain(first.name);
    expect(names).not.toContain(second.name);
    expect(result.current.sheet!.title).toBe('Đập — thuộc tính');
    expect(result.current.sheet!.dictionaryKey).toBe('dams');
    dictionary = DICTIONARY;
  });

  it('Escape closes the sheet and returns focus to the ⓘ', async () => {
    dictionary = DICTIONARY;
    function Harness() {
      const { sheet, openSheet, close } = useDictionarySheetPresenter();
      return (
        <MemoryRouter>
          <LayersPanelView
            groups={[{ name: 'G', layers: [{ id: 'layer_dams', name: 'Đập', visible: false, opacity: 1, gated: false }] }]}
            missingDisplay={[]}
            onToggle={vi.fn()}
            onOpacity={vi.fn()}
            contourSettings={{ interval: 'auto', labels: true }}
            onContourSettings={vi.fn()}
            onInfo={openSheet}
          />
          {sheet && <DictionarySheetView {...sheet} onClose={close} />}
        </MemoryRouter>
      );
    }
    render(<Harness />);
    const info = screen.getByRole('button', { name: 'Thuộc tính của Đập' });
    await userEvent.click(info);
    expect(screen.getByRole('region', { name: 'Đập — thuộc tính' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(info).toHaveFocus();
  });
});
