import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import {
  ADMIN_PROVINCE_COLUMNS, ADMIN_WARD_COLUMNS, RIVER_REACH_COLUMNS, RIVER_WAY_COLUMNS, SEED_LAYER_COLUMNS,
} from './seed-columns';
import { assignDamStatus } from './dam-status';

describe('seed column maps', () => {
  it('cover every editable layer except rivers, which loads from two sources', () => {
    expect(Object.keys(SEED_LAYER_COLUMNS).sort()).toEqual(EDITABLE_LAYER_KEYS.filter((k) => k !== 'rivers').sort());
  });

  it('map a dam from the Open Development Vietnam field names, with its deterministic status', () => {
    const row = SEED_LAYER_COLUMNS.dams(
      { ID: 17, Vietnamese: 'Buôn Kuốp', English_hy: 'Buon Kuop', Wattage_PL: 280, 'Quantity_(': 1455, Year_of_la: 2003, Year_of_op: 2009 },
      0
    );
    expect(row).toEqual({
      external_id: 17, name: 'Buôn Kuốp', name_en: 'Buon Kuop', wattage_mw: 280,
      annual_output: 1455, year_launched: 2003, year_operational: 2009, status: assignDamStatus(17),
    });
  });

  it('map the synthetic layers from their camelCase properties', () => {
    expect(SEED_LAYER_COLUMNS.stations({ id: 's1', name: 'N', type: 'rain', status: 'ok', value: 3 }, 0))
      .toEqual({ external_id: 's1', name: 'N', station_type: 'rain', status: 'ok', value: 3 });
    expect(SEED_LAYER_COLUMNS.flood_zones({ id: 'f1', name: 'N', type: 'flood', area: 2, riskLevel: 'high' }, 0))
      .toEqual({ external_id: 'f1', name: 'N', hazard_type: 'flood', area: 2, risk_level: 'high' });
    expect(SEED_LAYER_COLUMNS.drought_points({ id: 'd1', name: 'N', riskLevel: 'low', status: 'ok', surveyDate: '2026-01-01' }, 0))
      .toEqual({ external_id: 'd1', name: 'N', risk_level: 'low', status: 'ok', survey_date: '2026-01-01' });
    expect(SEED_LAYER_COLUMNS.saltwater_intrusion({ id: 'x1', name: 'N', salinity: 4, riskLevel: 'low', status: 'ok' }, 0))
      .toEqual({ external_id: 'x1', name: 'N', salinity: 4, risk_level: 'low', status: 'ok' });
    expect(SEED_LAYER_COLUMNS.flood_generation({ id: 'g1', name: 'N', riskLevel: 'low', area: 5, flowRate: 9 }, 0))
      .toEqual({ external_id: 'g1', name: 'N', risk_level: 'low', area: 5, flow_rate: 9 });
  });

  it('map an OSM lake, leaving the HydroLAKES-only measures null', () => {
    expect(SEED_LAYER_COLUMNS.lakes({ osmId: 99, name: 'Hồ Lắk', lakeType: 'Lake' }, 0)).toEqual({
      external_id: 99, name: 'Hồ Lắk', lake_type: 'Lake', area_km2: null, volume_mcm: null, shore_len_km: null,
    });
  });

  it("prefix an OSM way id with 'osm:' so it can never be mistaken for a HYRIV_ID", () => {
    expect(RIVER_WAY_COLUMNS({ osmId: 123, waterway: 'river', name: 'Sông Ba', streamOrder: 4, lengthM: 1500 }, 0))
      .toEqual({ external_id: 'osm:123', code: 'river', name: 'Sông Ba', stream_order: 4, length_m: 1500 });
  });

  it('map a HydroRIVERS reach as a level-2 row, with a terminal reach flowing into NULL', () => {
    expect(RIVER_REACH_COLUMNS({ HYRIV_ID: 40001, NEXT_DOWN: 40002, ORD_STRA: 3, LENGTH_KM: 2.5 }, 0)).toEqual({
      external_id: 'hyriv:40001', feature_level: 2, flows_into_external_id: 'hyriv:40002',
      stream_order: 3, length_m: 2500, name: null,
    });
    expect(RIVER_REACH_COLUMNS({ HYRIV_ID: 40002, NEXT_DOWN: 0, ORD_STRA: 4, LENGTH_KM: 1 }, 0).flows_into_external_id).toBeNull();
  });

  it('map a province and a ward from the boundary files, coercing codes to text', () => {
    expect(ADMIN_PROVINCE_COLUMNS({ code: 66, name: 'Đắk Lắk', nameEn: 'Dak Lak', fullName: 'Tỉnh Đắk Lắk', areaKm2: 18096.4 }, 0))
      .toEqual({ code: '66', name: 'Đắk Lắk', name_en: 'Dak Lak', full_name: 'Tỉnh Đắk Lắk', area_km2: 18096.4 });
    expect(ADMIN_PROVINCE_COLUMNS({ code: '01', name: 'Hà Nội' }, 0))
      .toEqual({ code: '01', name: 'Hà Nội', name_en: null, full_name: null, area_km2: null });
    expect(ADMIN_WARD_COLUMNS({ code: 24133, provinceCode: 66, name: 'Buôn Ma Thuột' }, 0))
      .toEqual({ code: '24133', province_code: '66', name: 'Buôn Ma Thuột', name_en: null, full_name: null, area_km2: null });
  });
});
