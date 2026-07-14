import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
export { layerGroups } from '../../data/mockData';

export interface LayerRegistryEntry {
  layerKey: EditableLayerKey;
  layerStateId: string;
  wfsTypeName: string;
}

export const LAYER_REGISTRY: LayerRegistryEntry[] = EDITABLE_LAYER_KEYS.map((layerKey) => ({
  layerKey,
  layerStateId: LAYER_ATTRIBUTE_MAP[layerKey].layerStateId,
  wfsTypeName: LAYER_ATTRIBUTE_MAP[layerKey].wfsTypeName,
}));
