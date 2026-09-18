/**
 * Coordinate systems offered in the coordinate readout, the analysis results and the
 * print page. Display only: the map view stays EPSG:3857 and stored data EPSG:4326.
 *
 * VN-2000 datum parameters are copied verbatim from PostGIS spatial_ref_sys (EPSG
 * 4756/3405/3406), not typed from memory. TM-3 central meridians follow Thông tư
 * 973/2001/TT-TCĐC; provinces merged on 01/7/2025 keep one entry per former province,
 * because survey documents still cite the old province's meridian.
 */
export interface CrsOption {
  id: string;
  alias: string;
  kind: 'geographic' | 'projected';
  proj4: string;
  format?: 'dd' | 'dms';
}

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';
/** From spatial_ref_sys srid 4756 (Step 1). */
const VN2000_GEOGRAPHIC = '+proj=longlat +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +no_defs';
/** The +ellps/+towgs84 portion of srid 3405 (Step 1). */
const VN2000_DATUM = '+ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs';

const tm3 = (id: string, alias: string, lon0: number): CrsOption => ({
  id: `vn2000-tm3-${id}`,
  alias,
  kind: 'projected',
  proj4: `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9999 +x_0=500000 +y_0=0 ${VN2000_DATUM}`,
});

export const DEFAULT_CRS_ID = 'wgs84-dd';

export const CRS_OPTIONS: CrsOption[] = [
  { id: 'wgs84-dd', alias: 'WGS 84 — độ thập phân (EPSG:4326)', kind: 'geographic', proj4: WGS84, format: 'dd' },
  { id: 'wgs84-dms', alias: 'WGS 84 — độ phút giây', kind: 'geographic', proj4: WGS84, format: 'dms' },
  { id: 'wgs84-utm48', alias: 'WGS 84 / UTM 48N (EPSG:32648)', kind: 'projected', proj4: '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs' },
  { id: 'wgs84-utm49', alias: 'WGS 84 / UTM 49N (EPSG:32649)', kind: 'projected', proj4: '+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs' },
  { id: 'vn2000-geo', alias: 'VN-2000 — độ thập phân (EPSG:4756)', kind: 'geographic', proj4: VN2000_GEOGRAPHIC, format: 'dd' },
  { id: 'vn2000-utm48', alias: 'VN-2000 / UTM 48N (EPSG:3405)', kind: 'projected', proj4: `+proj=utm +zone=48 ${VN2000_DATUM}` },
  { id: 'vn2000-utm49', alias: 'VN-2000 / UTM 49N (EPSG:3406)', kind: 'projected', proj4: `+proj=utm +zone=49 ${VN2000_DATUM}` },
  tm3('da-nang', 'VN-2000 / Đà Nẵng (KTT 107°45′)', 107.75),
  tm3('quang-nam', 'VN-2000 / Đà Nẵng — cũ Quảng Nam (KTT 107°45′)', 107.75),
  tm3('quang-ngai', 'VN-2000 / Quảng Ngãi (KTT 108°00′)', 108.0),
  tm3('kon-tum', 'VN-2000 / Quảng Ngãi — cũ Kon Tum (KTT 107°30′)', 107.5),
  tm3('gia-lai', 'VN-2000 / Gia Lai (KTT 108°30′)', 108.5),
  tm3('binh-dinh', 'VN-2000 / Gia Lai — cũ Bình Định (KTT 108°15′)', 108.25),
  tm3('khanh-hoa', 'VN-2000 / Khánh Hòa (KTT 108°15′)', 108.25),
  tm3('ninh-thuan', 'VN-2000 / Khánh Hòa — cũ Ninh Thuận (KTT 108°15′)', 108.25),
  tm3('dak-lak', 'VN-2000 / Đắk Lắk (KTT 108°30′)', 108.5),
  tm3('phu-yen', 'VN-2000 / Đắk Lắk — cũ Phú Yên (KTT 108°30′)', 108.5),
  tm3('lam-dong', 'VN-2000 / Lâm Đồng (KTT 107°45′)', 107.75),
  tm3('dak-nong', 'VN-2000 / Lâm Đồng — cũ Đắk Nông (KTT 108°30′)', 108.5),
  tm3('binh-thuan', 'VN-2000 / Lâm Đồng — cũ Bình Thuận (KTT 108°30′)', 108.5),
];

export function findCrs(id: string): CrsOption {
  return CRS_OPTIONS.find((o) => o.id === id) ?? CRS_OPTIONS[0];
}
