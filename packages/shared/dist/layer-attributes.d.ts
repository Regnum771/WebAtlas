import type { EditableLayerKey } from './index';
import type { LayerFeatureProperties } from './feature-properties';
export interface LayerAttributeInfo {
    /** GeoServer WFS typeName, e.g. "webatlas:dams" */
    wfsTypeName: string;
    /** The map's layersState id (legacy, unchanged), e.g. "layer_dams" */
    layerStateId: string;
    /** DB column name -> ISO 19103 / INSPIRE-aligned attribute name */
    attributes: Record<string, string>;
}
export declare const LAYER_ATTRIBUTE_MAP: Record<EditableLayerKey, LayerAttributeInfo>;
/**
 * Rename a feature's DB-column properties to their ISO/INSPIRE names.
 * - `id` (uuid) is passed through unchanged (needed for future CRUD).
 * - Unknown keys are passed through unchanged.
 * - A `layerKey` discriminator is stamped onto the result.
 */
export declare function normalizeFeatureProperties(layerKey: EditableLayerKey, dbProps: Record<string, unknown>): LayerFeatureProperties;
