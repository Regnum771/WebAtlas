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

export const LAYER_ATTRIBUTE_MAP: Record<EditableLayerKey, LayerAttributeInfo> = {
  dams: {
    wfsTypeName: 'webatlas:dams',
    layerStateId: 'layer_dams',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      name_en: 'geographicalNameEn',
      wattage_mw: 'ratedPower',
      annual_output: 'annualGeneration',
      year_launched: 'constructionYear',
      year_operational: 'commissioningYear',
      status: 'operationalStatus',
    },
  },
  rivers: {
    wfsTypeName: 'webatlas:rivers',
    layerStateId: 'layer_rivers',
    attributes: {
      external_id: 'localId',
      code: 'hydroId',
      name: 'geographicalName',
      stream_order: 'streamOrder',
      length_m: 'length',
    },
  },
  stations: {
    wfsTypeName: 'webatlas:stations',
    layerStateId: 'layer_stations',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      station_type: 'measurementType',
      status: 'operationalStatus',
      value: 'measurementValue',
    },
  },
  flood_zones: {
    wfsTypeName: 'webatlas:flood_zones',
    layerStateId: 'layer_flood',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      hazard_type: 'hazardType',
      area: 'affectedArea',
      risk_level: 'riskLevel',
    },
  },
  drought_points: {
    wfsTypeName: 'webatlas:drought_points',
    layerStateId: 'layer_drought_survey',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      risk_level: 'riskLevel',
      status: 'observedStatus',
      survey_date: 'observationDate',
    },
  },
  saltwater_intrusion: {
    wfsTypeName: 'webatlas:saltwater_intrusion',
    layerStateId: 'layer_saltwater_intrusion',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      salinity: 'salinity',
      risk_level: 'riskLevel',
      status: 'observedStatus',
    },
  },
  flood_generation: {
    wfsTypeName: 'webatlas:flood_generation',
    layerStateId: 'layer_flood_generation',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      risk_level: 'riskLevel',
      area: 'catchmentArea',
      flow_rate: 'flowCharacteristics',
    },
  },
};

/**
 * Rename a feature's DB-column properties to their ISO/INSPIRE names.
 * - `id` (uuid) is passed through unchanged (needed for future CRUD).
 * - Unknown keys are passed through unchanged.
 * - A `layerKey` discriminator is stamped onto the result.
 */
export function normalizeFeatureProperties(
  layerKey: EditableLayerKey,
  dbProps: Record<string, unknown>
): LayerFeatureProperties {
  const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dbProps)) {
    if (k === 'id') {
      out.id = v;
    } else if (map[k]) {
      out[map[k]] = v;
    } else {
      out[k] = v;
    }
  }
  out.layerKey = layerKey;
  return out as unknown as LayerFeatureProperties;
}

/**
 * Inverse of `normalizeFeatureProperties`: rename ISO/INSPIRE property names back
 * to their DB columns for a given layer.
 * - `id` (uuid) passes through unchanged.
 * - The `layerKey` discriminator is dropped.
 * - Unknown keys pass through unchanged.
 * A round-trip `denormalize(normalize(db))` returns the original DB props.
 */
export function denormalizeFeatureProperties(
  layerKey: EditableLayerKey,
  isoProps: Record<string, unknown>
): Record<string, unknown> {
  const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
  const inverse: Record<string, string> = {};
  for (const [dbCol, isoName] of Object.entries(map)) inverse[isoName] = dbCol;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(isoProps)) {
    if (k === 'layerKey') continue;
    if (k === 'id') out.id = v;
    else if (inverse[k]) out[inverse[k]] = v;
    else out[k] = v;
  }
  return out;
}
