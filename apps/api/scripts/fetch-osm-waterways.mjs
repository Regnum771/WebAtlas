/**
 * Tải dữ liệu thủy văn OSM cho vùng công tác qua Overpass API.
 *
 * Tải RỘNG (mọi giá trị waterway + mọi mặt nước) chứ không chỉ các tag sẽ dùng,
 * để explore-osm.mjs còn phát hiện được thứ đáng dùng mà ta chưa nghĩ tới.
 *
 * Truy vấn theo TỪNG TỈNH: Overpass đã từ chối truy vấn cả vùng vì quá lớn.
 *
 * Đầu ra (KHÔNG commit — dữ liệu thô, task sau sẽ cắt và commit bản đã lọc):
 *   apps/api/scripts/.osm-cache/osm-waterways-raw.geojson
 *   apps/api/scripts/.osm-cache/osm-water-raw.geojson
 *
 * Chạy: node apps/api/scripts/fetch-osm-waterways.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpassQuery, bboxOf } from './lib/overpass.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const cacheDir = path.join(scriptDir, '.osm-cache');
const provincesPath = path.join(repoRoot, 'apps/web/public/provinces-34.geojson');

const REGION_CODES = ['48', '51', '52', '56', '66', '68'];

/** Chuyển phần tử Overpass (có `geometry`) thành GeoJSON Feature. */
function toFeature(el) {
  if (!el.geometry || el.geometry.length < 2) return null;
  const coords = el.geometry.map((p) => [p.lon, p.lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  // Vòng khép kín >= 4 điểm là polygon (hồ/mặt nước); còn lại là đường (dòng chảy).
  const geometry = closed && coords.length >= 4
    ? { type: 'Polygon', coordinates: [coords] }
    : { type: 'LineString', coordinates: coords };
  return { type: 'Feature', properties: { ...el.tags, osmId: el.id }, geometry };
}

async function fetchForBbox(label, bbox, selector) {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const query = `[out:json][timeout:300];
(${selector.map((s) => `way${s}(${minLat},${minLon},${maxLat},${maxLon});`).join('')});
out geom;`;
  const data = await overpassQuery(query);
  const features = (data.elements ?? []).map(toFeature).filter(Boolean);
  console.log(`  ${label}: ${features.length} đối tượng`);
  return features;
}

async function main() {
  fs.mkdirSync(cacheDir, { recursive: true });
  const provinces = JSON.parse(fs.readFileSync(provincesPath, 'utf8'));

  const waterways = [];
  const waters = [];

  for (const code of REGION_CODES) {
    const feature = provinces.features.find((f) => f.properties.code === code);
    if (!feature) throw new Error(`Không tìm thấy tỉnh mã ${code} trong provinces-34.geojson`);
    const bbox = bboxOf([feature]);
    console.log(`Tỉnh ${code} (${feature.properties.name}) bbox=${bbox.map((n) => n.toFixed(2)).join(',')}`);

    waterways.push(...await fetchForBbox('waterway', bbox, ['["waterway"]']));
    waters.push(...await fetchForBbox('mặt nước', bbox, ['["natural"="water"]', '["landuse"="reservoir"]']));
  }

  /** Bỏ trùng theo osmId — bbox các tỉnh chồng lấn nhau. */
  const dedupe = (features) => {
    const seen = new Map();
    for (const f of features) seen.set(f.properties.osmId, f);
    return [...seen.values()];
  };

  const uniqueWaterways = dedupe(waterways);
  const uniqueWaters = dedupe(waters);

  fs.writeFileSync(path.join(cacheDir, 'osm-waterways-raw.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: uniqueWaterways }));
  fs.writeFileSync(path.join(cacheDir, 'osm-water-raw.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: uniqueWaters }));

  console.log(`\nwaterway: ${waterways.length} -> ${uniqueWaterways.length} sau khi bỏ trùng`);
  console.log(`mặt nước: ${waters.length} -> ${uniqueWaters.length} sau khi bỏ trùng`);
  console.log(`Đã ghi vào ${cacheDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
