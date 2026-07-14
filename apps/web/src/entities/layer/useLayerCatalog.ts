import { useQuery } from '@tanstack/react-query';
import { fetchLayerCatalog, type LayerCatalogEntry } from './layersCatalog.api';

export type { LayerCatalogEntry };

export function useLayerCatalog() {
  return useQuery({ queryKey: ['layers'], queryFn: fetchLayerCatalog });
}
