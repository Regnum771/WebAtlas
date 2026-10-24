import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DICTIONARY, mergeDictionary, type Dictionary } from '@webatlas/shared';
import { fetchDictionary } from '../api/dictionary.api';

/** Code defaults at once; the served copy replaces them once loaded. A failed fetch is silent. */
export function useDictionary(): Dictionary {
  const { data } = useQuery({
    queryKey: ['dictionary'],
    queryFn: fetchDictionary,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return useMemo(() => mergeDictionary(DICTIONARY, data?.featureTypes), [data]);
}
