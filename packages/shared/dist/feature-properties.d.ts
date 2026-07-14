import type { EditableLayerKey } from './index';
/** Common properties present on every normalized thematic feature. */
export interface BaseFeatureProperties {
    layerKey: EditableLayerKey;
    id?: string;
    localId?: number | string;
    geographicalName?: string;
}
export interface DamProperties extends BaseFeatureProperties {
    layerKey: 'dams';
    geographicalNameEn?: string;
    ratedPower?: number;
    annualGeneration?: number;
    constructionYear?: string;
    commissioningYear?: string;
    operationalStatus?: string;
}
export interface RiverProperties extends BaseFeatureProperties {
    layerKey: 'rivers';
    hydroId?: string;
    streamOrder?: number;
    length?: number;
}
export interface StationProperties extends BaseFeatureProperties {
    layerKey: 'stations';
    measurementType?: string;
    operationalStatus?: string;
    measurementValue?: string;
}
export interface FloodZoneProperties extends BaseFeatureProperties {
    layerKey: 'flood_zones';
    hazardType?: string;
    affectedArea?: string;
    riskLevel?: string;
}
export interface DroughtPointProperties extends BaseFeatureProperties {
    layerKey: 'drought_points';
    riskLevel?: string;
    observedStatus?: string;
    observationDate?: string;
}
export interface SaltwaterIntrusionProperties extends BaseFeatureProperties {
    layerKey: 'saltwater_intrusion';
    salinity?: string;
    riskLevel?: string;
    observedStatus?: string;
}
export interface FloodGenerationProperties extends BaseFeatureProperties {
    layerKey: 'flood_generation';
    riskLevel?: string;
    catchmentArea?: string;
    flowCharacteristics?: string;
}
export type LayerFeatureProperties = DamProperties | RiverProperties | StationProperties | FloodZoneProperties | DroughtPointProperties | SaltwaterIntrusionProperties | FloodGenerationProperties;
