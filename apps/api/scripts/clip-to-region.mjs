/**
 * Lọc mọi dữ liệu chuyên đề xuống đúng vùng công tác (6 tỉnh).
 *
 * Chạy trên các file seed tại chỗ (ghi đè). Dữ liệu seed đã được commit nên
 * `git restore` khôi phục được nếu cần.
 *
 * Chạy: node apps/api/scripts/clip-to-region.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegionRings, featureIntersectsRegion } from './lib/regionClip.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const dataDir = path.join(repoRoot, 'apps/api/src/db/seeds/data');
const provincesPath = path.join(repoRoot, 'apps/web/public/provinces-34.geojson');

// Giữ đồng bộ với REGION_PROVINCE_CODES trong packages/shared/src/region.ts.
const REGION_CODES = ['48', '51', '52', '56', '66', '68'];

// Mọi file seed chuyên đề. Layer nào chưa có file thì bỏ qua trong im lặng.
// LƯU Ý: dams nằm ở apps/web/public/ chứ không phải thư mục seed, nên phải
// liệt kê đường dẫn riêng — 205/371 đập nằm ngoài vùng nếu không cắt.
const TARGETS = [
  path.join(dataDir, 'osm-rivers-region.geojson'),
  path.join(dataDir, 'osm-lakes-region.geojson'),
  path.join(dataDir, 'stations.geojson'),
  path.join(dataDir, 'flood_zones.geojson'),
  path.join(dataDir, 'drought_points.geojson'),
  path.join(dataDir, 'saltwater_intrusion.geojson'),
  path.join(dataDir, 'flood_generation.geojson'),
  path.join(repoRoot, 'apps/web/public/thuydienvietnam.geojson'),
];

const provinces = JSON.parse(fs.readFileSync(provincesPath, 'utf8'));
const rings = buildRegionRings(provinces, REGION_CODES);
console.log(`Ranh giới vùng: ${rings.length} polygon từ ${REGION_CODES.length} tỉnh`);

for (const filePath of TARGETS) {
  const file = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    console.log(`${file}: (không có, bỏ qua)`);
    continue;
  }
  const fc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const before = fc.features.length;
  // Đập thiếu toạ độ (geom null) vẫn giữ: chúng là bản ghi danh mục hợp lệ,
  // đã có báo cáo riêng ở Task 13 và bị lọc ở frontend.
  fc.features = fc.features.filter((f) => !f.geometry || featureIntersectsRegion(f, rings));
  const after = fc.features.length;
  fs.writeFileSync(filePath, JSON.stringify(fc));
  const mb = (fs.statSync(filePath).size / 1048576).toFixed(1);
  console.log(`${file}: ${before} -> ${after} (bỏ ${before - after}), ${mb} MB`);
}
