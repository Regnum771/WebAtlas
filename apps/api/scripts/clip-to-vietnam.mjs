/**
 * Lọc dữ liệu HydroSHEDS đã clip theo bbox xuống đúng phần nằm trong lãnh thổ Việt Nam.
 *
 * Vì sao cần: prep_hydrosheds.py cắt theo BBOX hình chữ nhật (102 8 110 24), nên dữ liệu
 * còn lẫn sông/hồ của Lào, Campuchia, Trung Quốc, Thái Lan nằm trong khung đó. Bản đồ chỉ
 * hiển thị địa bàn Việt Nam nên phần ngoài lãnh thổ là nhiễu.
 *
 * Ranh giới quốc gia được hợp nhất từ 34 tỉnh sau sáp nhập (provinces-34.geojson) — không
 * cần thêm tệp nguồn mới. Một đối tượng được giữ nếu có BẤT KỲ đỉnh nào nằm trong lãnh thổ,
 * nên các con sông biên giới (chỉ một nửa thuộc VN) vẫn được giữ nguyên vẹn thay vì bị
 * cắt cụt giữa dòng.
 *
 * Dùng:
 *   node apps/api/scripts/clip-to-vietnam.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const dataDir = path.join(repoRoot, 'apps/api/src/db/seeds/data');
const boundaryPath = path.join(repoRoot, 'apps/web/public/provinces-34.geojson');

/** Gom mọi vòng ngoài của 34 tỉnh thành một danh sách polygon phẳng. */
function loadVietnamRings() {
  const fc = JSON.parse(fs.readFileSync(boundaryPath, 'utf8'));
  const polygons = [];
  for (const feature of fc.features) {
    const { type, coordinates } = feature.geometry;
    const parts = type === 'MultiPolygon' ? coordinates : [coordinates];
    for (const part of parts) {
      // part[0] là vòng ngoài; bỏ qua các vòng lỗ (hiếm và không đáng kể ở tỷ lệ này).
      const ring = part[0];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      polygons.push({ ring, minX, minY, maxX, maxY });
    }
  }
  return polygons;
}

/** Ray casting cho một vòng đơn. */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInVietnam(x, y, polygons) {
  for (const p of polygons) {
    // Bounding box loại nhanh phần lớn polygon trước khi chạy ray casting.
    if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
    if (pointInRing(x, y, p.ring)) return true;
  }
  return false;
}

/** Duyệt mọi toạ độ của một geometry, dừng ngay khi gặp đỉnh đầu tiên nằm trong VN. */
function anyVertexInVietnam(geometry, polygons) {
  const stack = [geometry.coordinates];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node[0] === 'number') {
      if (pointInVietnam(node[0], node[1], polygons)) return true;
    } else {
      for (const child of node) stack.push(child);
    }
  }
  return false;
}

const polygons = loadVietnamRings();
console.log(`Ranh giới: ${polygons.length} polygon từ 34 tỉnh sau sáp nhập`);

for (const file of ['hydrorivers-vn.geojson', 'hydrolakes-vn.geojson']) {
  const filePath = path.join(dataDir, file);
  const fc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const before = fc.features.length;
  fc.features = fc.features.filter((f) => f.geometry && anyVertexInVietnam(f.geometry, polygons));
  const after = fc.features.length;
  fs.writeFileSync(filePath, JSON.stringify(fc));
  const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  console.log(`${file}: ${before} -> ${after} (bỏ ${before - after}), ${sizeMb} MB`);
}
