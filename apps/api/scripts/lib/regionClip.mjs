/**
 * Lọc GeoJSON feature xuống đúng vùng công tác.
 *
 * Quy tắc: một đối tượng được GIỮ NGUYÊN VẸN nếu có BẤT KỲ đỉnh nào nằm trong
 * vùng. Cố ý không cắt hình học — sông chảy qua ranh giới tỉnh phải liền mạch,
 * không bị cụt giữa dòng.
 *
 * Thay thế clip-to-vietnam.mjs (cùng thuật toán, khác ranh giới đầu vào).
 */

/** Gom các vòng ngoài của những tỉnh được chọn, kèm bbox để loại nhanh. */
export function buildRegionRings(provincesGeoJson, provinceCodes) {
  const wanted = new Set(provinceCodes);
  const found = new Set();
  const polygons = [];

  for (const feature of provincesGeoJson.features) {
    const code = feature.properties?.code;
    if (!wanted.has(code)) continue;
    found.add(code);

    const { type, coordinates } = feature.geometry;
    const parts = type === 'MultiPolygon' ? coordinates : [coordinates];
    for (const part of parts) {
      // part[0] là vòng ngoài; bỏ qua vòng lỗ (không đáng kể ở tỷ lệ này).
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

  const missing = [...wanted].filter((c) => !found.has(c));
  if (missing.length) {
    throw new Error(`Không tìm thấy tỉnh với mã: ${missing.join(', ')}`);
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

function pointInRegion(x, y, polygons) {
  for (const p of polygons) {
    // Bbox loại nhanh phần lớn polygon trước khi ray casting.
    if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
    if (pointInRing(x, y, p.ring)) return true;
  }
  return false;
}

/** Feature có đỉnh nào nằm trong vùng không? Dừng ngay khi tìm thấy. */
export function featureIntersectsRegion(feature, polygons) {
  const geometry = feature?.geometry;
  if (!geometry?.coordinates) return false;

  const stack = [geometry.coordinates];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node[0] === 'number') {
      if (pointInRegion(node[0], node[1], polygons)) return true;
    } else {
      for (const child of node) stack.push(child);
    }
  }
  return false;
}
