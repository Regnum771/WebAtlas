export const LAYER_ATTRIBUTE_MAP = {
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
export function normalizeFeatureProperties(layerKey, dbProps) {
    const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
    const out = {};
    for (const [k, v] of Object.entries(dbProps)) {
        if (k === 'id') {
            out.id = v;
        }
        else if (map[k]) {
            out[map[k]] = v;
        }
        else {
            out[k] = v;
        }
    }
    out.layerKey = layerKey;
    return out;
}
