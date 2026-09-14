/**
 * Tải ranh giới hành chính Việt Nam sau sáp nhập (01/7/2025) và ghi ra hai
 * file GeoJSON cho frontend.
 *
 * Nguồn: https://github.com/thanglequoc/vietnamese-provinces-database (MIT),
 * dữ liệu gốc từ NXB Tài nguyên – Môi trường và Bản đồ (Bộ NN&MT),
 * cập nhật theo nghị quyết 30/2026/QH16. EPSG:4326.
 *
 * Đầu ra:
 *   apps/web/public/provinces-34.geojson  — 34 tỉnh, cả nước
 *   apps/web/public/wards-region.geojson  — xã của 6 tỉnh trong vùng
 *
 * Hình học BẮT BUỘC phải đơn giản hóa: dữ liệu xã thô là 157 MB.
 *
 * Chạy: node apps/api/scripts/fetch-boundaries.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simplifyGeometry, roundCoords, countPoints } from './lib/simplify.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const outDir = path.join(repoRoot, 'apps/web/public');

const RAW = 'https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/master/json/geojson';
const API = 'https://api.github.com/repos/thanglequoc/vietnamese-provinces-database/contents/json/geojson';

// Giữ đồng bộ với REGION_PROVINCE_CODES trong packages/shared/src/region.ts.
// Script .mjs không import được TS nên phải lặp lại; test ở Task 4 kiểm tra khớp.
const REGION_CODES = ['48', '51', '52', '56', '66', '68'];

const SIMPLIFY_TOLERANCE = 0.0001; // ~11 m
const COORD_DECIMALS = 5;          // ~1,1 m

/** Tải JSON, tự thử lại — GitHub API có giới hạn tần suất. */
async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': 'webatlas-fetch-boundaries' } });
  if (!res.ok) {
    if (attempt < 4) {
      const wait = attempt * 3000;
      console.warn(`  ! ${res.status} ${url} — thử lại sau ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`Tải thất bại sau 4 lần: ${res.status} ${url}`);
  }
  return res.json();
}

/** FeatureCollection hoặc Feature đơn -> mảng feature. */
function toFeatures(geojson) {
  if (geojson.type === 'FeatureCollection') return geojson.features;
  if (geojson.type === 'Feature') return [geojson];
  throw new Error(`GeoJSON không nhận dạng được: ${geojson.type}`);
}

/** Đơn giản hóa + làm tròn geometry của một feature. */
function shrink(feature) {
  const simplified = simplifyGeometry(feature.geometry, SIMPLIFY_TOLERANCE);
  return { ...feature, geometry: roundCoords(simplified, COORD_DECIMALS) };
}

async function main() {
  console.log('Liệt kê danh sách tỉnh...');
  const dirs = (await fetchJson(API)).filter((e) => e.type === 'dir').map((e) => e.name);
  if (dirs.length !== 34) {
    throw new Error(`Kỳ vọng 34 tỉnh, nguồn trả về ${dirs.length}. Nguồn có thể đã đổi cấu trúc.`);
  }

  // --- Tỉnh: cả nước ---
  const provinceFeatures = [];
  let rawPoints = 0;
  let outPoints = 0;
  for (const dir of dirs) {
    const data = await fetchJson(`${RAW}/${dir}/${dir}.geojson`);
    for (const f of toFeatures(data)) {
      rawPoints += countPoints(f.geometry);
      const small = shrink(f);
      outPoints += countPoints(small.geometry);
      provinceFeatures.push(small);
    }
    process.stdout.write(`\r  tỉnh: ${provinceFeatures.length}/34`);
  }
  console.log('');

  const provincePath = path.join(outDir, 'provinces-34.geojson');
  fs.writeFileSync(provincePath, JSON.stringify({ type: 'FeatureCollection', features: provinceFeatures }));
  console.log(`provinces-34.geojson: ${provinceFeatures.length} tỉnh, ` +
    `${(fs.statSync(provincePath).size / 1048576).toFixed(1)} MB ` +
    `(điểm ${rawPoints} -> ${outPoints})`);

  // --- Xã: chỉ 6 tỉnh trong vùng ---
  const wardFeatures = [];
  let wRaw = 0;
  let wOut = 0;
  for (const code of REGION_CODES) {
    const dir = dirs.find((d) => d.startsWith(`${code}_`));
    if (!dir) throw new Error(`Không tìm thấy thư mục cho mã tỉnh ${code}`);
    const listing = await fetchJson(`${API}/${dir}/wards`);
    const files = listing.filter((e) => e.type === 'file' && e.name.endsWith('.geojson'));
    for (const file of files) {
      const data = await fetchJson(`${RAW}/${dir}/wards/${file.name}`);
      for (const f of toFeatures(data)) {
        wRaw += countPoints(f.geometry);
        const small = shrink(f);
        wOut += countPoints(small.geometry);
        // Gắn mã tỉnh để lọc/kiểm tra được ở phía sau.
        small.properties = { ...small.properties, provinceCode: code };
        wardFeatures.push(small);
      }
    }
    process.stdout.write(`\r  xã: ${wardFeatures.length} (xong tỉnh ${code})`);
  }
  console.log('');

  const wardPath = path.join(outDir, 'wards-region.geojson');
  fs.writeFileSync(wardPath, JSON.stringify({ type: 'FeatureCollection', features: wardFeatures }));
  console.log(`wards-region.geojson: ${wardFeatures.length} xã, ` +
    `${(fs.statSync(wardPath).size / 1048576).toFixed(1)} MB ` +
    `(điểm ${wRaw} -> ${wOut})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
