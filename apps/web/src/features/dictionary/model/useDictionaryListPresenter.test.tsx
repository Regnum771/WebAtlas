import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DICTIONARY, type Dictionary } from '@webatlas/shared';
import { useDictionaryListPresenter } from './useDictionaryListPresenter';
import { DictionaryListView } from '../ui/DictionaryList.view';

let dictionary: Dictionary = DICTIONARY;
vi.mock('./useDictionary', () => ({ useDictionary: () => dictionary }));

function Harness() {
  const p = useDictionaryListPresenter();
  return (
    <MemoryRouter>
      <DictionaryListView {...p} />
    </MemoryRouter>
  );
}

describe('useDictionaryListPresenter', () => {
  it('the list groups vector and raster layers', () => {
    dictionary = DICTIONARY;
    const { result } = renderHook(() => useDictionaryListPresenter());
    expect(result.current.groups.map((g) => g.title)).toEqual(['Lớp vectơ', 'Lớp ảnh']);
    const [vector, raster] = result.current.groups;
    const want = (kind: string) => Object.values(DICTIONARY).filter((f) => f.kind === kind && !f.validTo).length;
    expect(vector.rows).toHaveLength(want('vector'));
    expect(raster.rows).toHaveLength(want('raster'));
    expect(vector.rows.find((r) => r.key === 'dams')).toMatchObject({ name: DICTIONARY.dams.name });
  });

  it('leaves retired layers out', () => {
    dictionary = { ...DICTIONARY, dams: { ...DICTIONARY.dams, validTo: '2000-01-01' } };
    const { result } = renderHook(() => useDictionaryListPresenter());
    expect(result.current.groups.flatMap((g) => g.rows).some((r) => r.key === 'dams')).toBe(false);
    dictionary = DICTIONARY;
  });

  it('search ignores diacritics', async () => {
    dictionary = DICTIONARY;
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Tìm lớp'), 'dap');
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/du-lieu/dams');
    expect(link).toBeDefined();
    expect(link).toHaveTextContent(DICTIONARY.dams.name);
  });

  it('no match shows the empty message', async () => {
    dictionary = DICTIONARY;
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Tìm lớp'), 'zzzzqqq');
    expect(screen.getByText('Không có lớp nào khớp.')).toBeInTheDocument();
  });

  it('rows link to the layer page and the page links back to the map', () => {
    dictionary = DICTIONARY;
    render(<Harness />);
    expect(screen.getByRole('link', { name: 'Về bản đồ' })).toHaveAttribute('href', '/');
  });

  it('exposes setQuery for the search box', () => {
    const { result } = renderHook(() => useDictionaryListPresenter());
    act(() => result.current.onQuery('x'));
    expect(result.current.query).toBe('x');
  });
});
