import { useQuery } from '@tanstack/react-query';
import { fetchLayerCatalog } from './layersCatalog.api';

export function useLayerCatalog() {
  return useQuery({ queryKey: ['layers'], queryFn: fetchLayerCatalog });
}
