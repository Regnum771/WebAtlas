import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';
import type { LayerSummary } from '../api/workspace.api';

function officialName(layerKey: string | null): string {
  if (!layerKey) return '';
  const attr = LAYER_ATTRIBUTE_MAP[layerKey as EditableLayerKey];
  return (attr && LAYER_DISPLAY[attr.layerStateId]?.name) || layerKey;
}

/** The kind label of a layer row. A free layer with declared fields was drawn; one without came from a file. */
export function layerKindLabel(layer: Pick<LayerSummary, 'kind' | 'fields' | 'layerKey'>): string {
  switch (layer.kind) {
    case 'free': return layer.fields.length > 0 ? 'Lớp vẽ' : 'Lớp từ tệp';
    case 'edit_copy': return `Sửa lớp ${officialName(layer.layerKey)}`;
    case 'raster': return 'Ảnh';
    default: return 'Ghi chú';
  }
}
