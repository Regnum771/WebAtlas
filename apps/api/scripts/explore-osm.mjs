/**
 * Thống kê dữ liệu OSM đã tải: giá trị tag nào có mặt, bao nhiêu đối tượng có
 * tên, phân bố ra sao.
 *
 * Đây là công cụ THƯỜNG TRỰC, không phải việc dùng một lần: mỗi lần cập nhật
 * dữ liệu OSM, chạy lại để biết nguồn đã thay đổi thế nào trước khi nạp.
 *
 * Chạy: node apps/api/scripts/explore-osm.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(scriptDir, '.osm-cache');

function report(file, tagKey) {
  const filePath = path.join(cacheDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`(thiếu ${file} — chạy fetch-osm-waterways.mjs trước)`);
    return;
  }
  const fc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const counts = {};
  const named = {};
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const value = p[tagKey] ?? p.water ?? p.landuse ?? p.natural ?? '(không rõ)';
    counts[value] = (counts[value] ?? 0) + 1;
    if (p.name) named[value] = (named[value] ?? 0) + 1;
  }
  console.log(`\n${file} — tổng ${fc.features.length} đối tượng`);
  console.log('  ' + 'giá trị'.padEnd(20) + 'số lượng'.padStart(9) + 'có tên'.padStart(9) + '  tỷ lệ tên');
  for (const [value, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const withName = named[value] ?? 0;
    const pct = ((withName / n) * 100).toFixed(0);
    console.log('  ' + String(value).padEnd(20) + String(n).padStart(9) + String(withName).padStart(9) + `  ${pct}%`);
  }
}

report('osm-waterways-raw.geojson', 'waterway');
report('osm-water-raw.geojson', 'water');
