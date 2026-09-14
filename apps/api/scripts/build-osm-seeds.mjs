/**
 * Chuyển dữ liệu OSM thô thành file seed cho layer rivers và lakes.
 *
 * Lọc theo tag, chuẩn hoá thuộc tính, rồi ghi vào thư mục seed. Bước cắt theo
 * vùng do clip-to-region.mjs đảm nhiệm (chạy sau script này).
 *
 * Chạy: node apps/api/scripts/build-osm-seeds.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waterwayToStreamOrder, osmWaterToLakeType } from '@webatlas/shared';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const cacheDir = path.join(scriptDir, '.osm-cache');
const seedDir = path.join(repoRoot, 'apps/api/src/db/seeds/data');

const EARTH_RADIUS_M = 6378137;

/**
 * Độ dài trắc địa của một chuỗi toạ độ lon/lat, tính bằng mét (haversine).
 *
 * OSM không có trường độ dài như HydroRIVERS (LENGTH_KM), nhưng popup đang
 * hiển thị "Chiều dài" nên phải tự tính — nếu để null thì mọi con sông hiện
 * dấu gạch. Cùng cách tiếp cận với công cụ đo trong app (ol/sphere getLength).
 */
function geodesicLengthM(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dPhi = phi2 - phi1;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dPhi / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    total += 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return Math.round(total);
}

function read(file) {
  const filePath = path.join(cacheDir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Thiếu ${filePath}. Chạy fetch-osm-waterways.mjs trước.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// --- Sông ---
const rawWaterways = read('osm-waterways-raw.geojson');
const rivers = [];
for (const f of rawWaterways.features) {
  const order = waterwayToStreamOrder(f.properties?.waterway);
  if (order === null) continue;              // bỏ dam/weir/waterfall/tag lạ
  if (f.geometry?.type !== 'LineString') continue; // dòng chảy phải là đường
  rivers.push({
    type: 'Feature',
    properties: {
      osmId: f.properties.osmId,
      name: f.properties.name ?? null,
      waterway: f.properties.waterway,
      streamOrder: order,
      lengthM: geodesicLengthM(f.geometry.coordinates),
    },
    geometry: f.geometry,
  });
}

// --- Hồ / mặt nước ---
const rawWater = read('osm-water-raw.geojson');
const lakes = [];
for (const f of rawWater.features) {
  const lakeType = osmWaterToLakeType(f.properties ?? {});
  if (lakeType === null) continue;
  if (f.geometry?.type !== 'Polygon') continue; // mặt nước phải là vùng
  lakes.push({
    type: 'Feature',
    properties: {
      osmId: f.properties.osmId,
      name: f.properties.name ?? null,
      lakeType,
    },
    geometry: f.geometry,
  });
}

fs.writeFileSync(path.join(seedDir, 'osm-rivers-region.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: rivers }));
fs.writeFileSync(path.join(seedDir, 'osm-lakes-region.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: lakes }));

const named = (arr) => arr.filter((f) => f.properties.name).length;
const totalKm = rivers.reduce((s, f) => s + f.properties.lengthM, 0) / 1000;
console.log(`osm-rivers-region.geojson: ${rivers.length} đối tượng, ${named(rivers)} có tên, tổng ${totalKm.toFixed(0)} km`);
console.log(`osm-lakes-region.geojson:  ${lakes.length} đối tượng, ${named(lakes)} có tên`);
console.log('Chạy tiếp clip-to-region.mjs để cắt xuống đúng vùng.');
