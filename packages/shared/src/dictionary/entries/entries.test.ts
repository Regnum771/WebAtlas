import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from '../../index.js';
import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import { DAM_STATUS_DISPLAY, DAM_STATUS_SLUGS } from '../../dam-status.js';
import { validateDictionary } from '../validate.js';
import { attributeOf, formatValue } from '../format.js';
import { DICTIONARY } from './index.js';

describe('dictionary entries', () => {
  it('the dictionary validates', () => {
    expect(validateDictionary(DICTIONARY)).toEqual([]);
  });

  it('the eight editable layers are present', () => {
    expect(EDITABLE_LAYER_KEYS.every((k) => DICTIONARY[k])).toBe(true);
    for (const k of EDITABLE_LAYER_KEYS) {
      const ft = DICTIONARY[k];
      expect(ft.table).toBe(`water.${k}`);
      expect(ft.crs).toBe(4326);
      expect(ft.geometryType).toBe(LAYER_GEOMETRY[k]);
      expect(ft.validFrom).toBe('2026-10-24');
    }
  });

  it('dam status is closed and names come from dam-status', () => {
    const status = attributeOf(DICTIONARY, 'dams', 'status')!;
    expect(status.valueType).toBe('code');
    expect(status.codeList).toBe('closed');
    expect(status.values?.map((v) => v.code)).toEqual([...DAM_STATUS_SLUGS]);
    for (const v of status.values ?? []) {
      expect(v.name).toBe(DAM_STATUS_DISPLAY[v.code as keyof typeof DAM_STATUS_DISPLAY].label);
    }
  });

  it('risk_level is closed on every layer that has it', () => {
    const layers = Object.values(DICTIONARY).filter((ft) => ft.attributes.some((a) => a.name === 'risk_level'));
    expect(layers.map((ft) => ft.key).sort()).toEqual(
      ['drought_points', 'flood_generation', 'flood_zones', 'saltwater_intrusion'],
    );
    for (const ft of layers) {
      const risk = attributeOf(DICTIONARY, ft.key, 'risk_level')!;
      expect(risk.codeList, ft.key).toBe('closed');
      expect(risk.values?.map((v) => v.code).sort(), ft.key).toEqual(['Cao', 'Trung bình']);
    }
  });

  it('read-only layers and rasters are present', () => {
    const tables: Record<string, string | undefined> = {
      provinces: 'admin.provinces',
      wards: 'admin.wards',
      contours: 'basemap.contours',
      osm_water: 'basemap.water_region',
      flood_stations: 'scenario.flood_station',
      flood_wards: 'scenario.flood_ward',
      flood_roads: 'scenario.flood_road',
      shelters: 'scenario.shelter',
      flood_history: 'scenario.flood_history',
      dem: 'basemap.dem_region',
      // Flood depth is PNG frames, not a table (Ruling 3).
      flood_depth: undefined,
    };
    for (const [key, table] of Object.entries(tables)) {
      const ft = DICTIONARY[key];
      expect(ft, key).toBeDefined();
      expect(ft.table, key).toBe(table);
      expect(ft.validFrom, key).toBe('2026-10-24');
      expect(ft.kind, key).toBe(key === 'dem' || key === 'flood_depth' ? 'raster' : 'vector');
    }
    expect(DICTIONARY.flood_depth.crs).toBe(3857);
  });

  it('the dem band is in metres with surface_altitude', () => {
    const dem = DICTIONARY.dem;
    expect(dem.crs).toBe(4326);
    expect(dem.attributes.map((a) => a.name)).toEqual(['1']);
    const band = attributeOf(DICTIONARY, 'dem', '1')!;
    expect(band.source).toBe('band');
    expect(band.valueType).toBe('number');
    expect(band.label).toBe('Độ cao');
    expect(band.storedUnit).toBe('m');
    expect(band.cfStandardName).toBe('surface_altitude');
    expect(band.nodata).toBe(-9999);
  });

  it('raster entries have only band attributes', () => {
    const rasters = Object.values(DICTIONARY).filter((ft) => ft.kind === 'raster');
    expect(rasters.map((ft) => ft.key).sort()).toEqual(['dem', 'flood_depth']);
    for (const ft of rasters) {
      expect(ft.geometryType, ft.key).toBeUndefined();
      expect(ft.attributes.length, ft.key).toBeGreaterThan(0);
      expect(ft.attributes.every((a) => a.source === 'band'), ft.key).toBe(true);
    }
    const depth = attributeOf(DICTIONARY, 'flood_depth', '1')!;
    expect(depth.storedUnit).toBe('m');
    expect(depth.displayUnits).toEqual(['m', 'cm']);
    expect(depth.cfStandardName).toBeUndefined();
  });

  it('osm_water fclass is closed and matches the basemap style codes', () => {
    // The codes the basemap_water style draws: packages/atlas-data/tools/basemap/styles.py:182-190.
    const styled = [
      'water', 'reservoir', 'riverbank', 'dock',
      'wetland', 'wetland_marsh', 'wetland_mangrove', 'wetland_tidalflat',
      'wetland_reedbed', 'wetland_swamp', 'wetland_wet_meadow',
    ];
    const fclass = attributeOf(DICTIONARY, 'osm_water', 'fclass')!;
    expect(fclass.valueType).toBe('code');
    expect(fclass.codeList).toBe('closed');
    expect(fclass.values?.map((v) => v.code).sort()).toEqual([...styled].sort());
  });

  it('volume is stored in million m³ and shown in triệu m³', () => {
    expect(formatValue(attributeOf(DICTIONARY, 'lakes', 'volume_mcm')!, 1250.5)).toBe('1.250,5 triệu m³');
  });
});
