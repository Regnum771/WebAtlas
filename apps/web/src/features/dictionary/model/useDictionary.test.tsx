import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DICTIONARY, labelFor } from '@webatlas/shared';
import * as api from '../api/dictionary.api';
import { useDictionary } from './useDictionary';

vi.mock('../api/dictionary.api');

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe('useDictionary', () => {
  it('returns the code defaults before the fetch resolves', () => {
    vi.mocked(api.fetchDictionary).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDictionary(), { wrapper: setup().wrapper });
    expect(labelFor(result.current, 'dams', 'wattage_mw')).toBe(
      labelFor(DICTIONARY, 'dams', 'wattage_mw'),
    );
    expect(labelFor(result.current, 'dams', 'wattage_mw')).not.toBe('wattage_mw');
  });

  it('served entries replace the defaults', async () => {
    const dams = DICTIONARY.dams;
    const served = {
      ...dams,
      attributes: dams.attributes.map((a) => (a.name === 'wattage_mw' ? { ...a, label: 'X' } : a)),
    };
    vi.mocked(api.fetchDictionary).mockResolvedValue({ version: 'v', featureTypes: [served] });
    const { result } = renderHook(() => useDictionary(), { wrapper: setup().wrapper });
    await waitFor(() => expect(labelFor(result.current, 'dams', 'wattage_mw')).toBe('X'));
  });

  it('a failed fetch keeps the code defaults', async () => {
    const fetch = vi.mocked(api.fetchDictionary).mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useDictionary(), { wrapper: setup().wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toBe(DICTIONARY);
    expect(labelFor(result.current, 'dams', 'wattage_mw')).not.toBe('wattage_mw');
  });
});
