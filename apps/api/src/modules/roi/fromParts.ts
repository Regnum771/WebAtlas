import type { DrawnRoiGeometry, EditableLayerKey, GeoJsonGeometry, ReferenceLayerKey, Roi } from '@webatlas/shared';
import { ValidationError } from '../../errors';

interface Parts {
  geometry?: GeoJsonGeometry;
  feature?: { layerKey: EditableLayerKey; featureId: string };
  reference?: { referenceLayer: ReferenceLayerKey; entityId: string; radiusKm?: number };
}

/**
 * The pre-ROI input families — buffer's HTTP body and the assistant tools' feature ids —
 * as an Roi, so they go through resolveRoi like everything else. A reference's own
 * radius wins over `radiusKm`, matching how buffer's body always read it.
 */
export function roiFromParts(parts: Parts, radiusKm?: number): Roi {
  const radius = radiusKm !== undefined ? { radiusKm } : {};
  if (parts.geometry) return { source: 'drawn', geometry: parts.geometry as DrawnRoiGeometry, ...radius };
  if (parts.reference) {
    const r = parts.reference.radiusKm ?? radiusKm;
    return {
      source: 'reference',
      referenceLayer: parts.reference.referenceLayer,
      entityId: parts.reference.entityId,
      ...(r !== undefined ? { radiusKm: r } : {}),
    };
  }
  if (parts.feature) {
    return { source: 'feature', layerKey: parts.feature.layerKey, featureId: parts.feature.featureId, ...radius };
  }
  throw new ValidationError('Thiếu vùng phân tích.');
}
