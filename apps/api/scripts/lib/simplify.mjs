/**
 * Đơn giản hóa và làm gọn GeoJSON geometry.
 *
 * Dữ liệu ranh giới xã từ nguồn là hình học đầy đủ độ chính xác: mỗi xã
 * ~2.487 điểm ở ~14 chữ số thập phân, tổng 157 MB cho 6 tỉnh. Ở mức zoom tối
 * đa của app (1:100.000, ~26 m/px), sai số 11 m nằm dưới nửa pixel — không
 * nhìn thấy được. Đơn giản hóa đưa 157 MB xuống ~10 MB.
 *
 * Mọi hàm ở đây đều thuần khiết: trả về geometry mới, không sửa đầu vào.
 */

/** Khoảng cách vuông góc từ điểm p tới đoạn thẳng a-b. */
function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas–Peucker trên một chuỗi điểm. */
function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, index + 1), tolerance);
    const right = douglasPeucker(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[last]];
}

/** Vòng khép kín (điểm đầu trùng điểm cuối)? */
function isClosedRing(points) {
  if (points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Đơn giản hóa một chuỗi điểm. Vòng khép kín được xử lý riêng: phải giữ khép
 * kín và không được rút xuống dưới 4 điểm, nếu không polygon thành không hợp lệ.
 */
function simplifyRing(points, tolerance) {
  if (!isClosedRing(points)) return douglasPeucker(points, tolerance);

  // Đơn giản hóa phần thân (bỏ điểm cuối trùng lặp), rồi khép lại.
  const body = points.slice(0, -1);
  let simplified = douglasPeucker(body, tolerance);

  // Chặn dưới: vòng cần tối thiểu 3 đỉnh phân biệt + 1 điểm khép = 4.
  if (simplified.length < 3) {
    // Lấy đều 3 điểm từ vòng gốc thay vì trả về hình suy biến.
    const step = Math.max(1, Math.floor(body.length / 3));
    simplified = [body[0], body[step] ?? body[1], body[step * 2] ?? body[body.length - 1]];
  }
  return [...simplified, simplified[0]];
}

/** Áp một hàm biến đổi lên mọi mảng điểm ở đúng độ sâu của geometry. */
function mapCoordinates(coords, fn) {
  // Một chuỗi điểm: [[x,y],[x,y],...]
  if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') return fn(coords);
  return coords.map((child) => mapCoordinates(child, fn));
}

/**
 * Đơn giản hóa geometry bằng Douglas–Peucker.
 * `tolerance` tính theo độ (0.0001 ≈ 11 m ở vĩ độ Việt Nam).
 * Point/MultiPoint được trả nguyên vẹn.
 */
export function simplifyGeometry(geometry, tolerance) {
  if (!geometry || !geometry.coordinates) return geometry;
  if (geometry.type === 'Point' || geometry.type === 'MultiPoint') return geometry;
  return {
    ...geometry,
    coordinates: mapCoordinates(geometry.coordinates, (ring) => simplifyRing(ring, tolerance)),
  };
}

/** Làm tròn mọi toạ độ về `decimals` chữ số thập phân. */
export function roundCoords(geometry, decimals) {
  if (!geometry || !geometry.coordinates) return geometry;
  const factor = 10 ** decimals;
  const round = (node) =>
    typeof node[0] === 'number'
      ? [Math.round(node[0] * factor) / factor, Math.round(node[1] * factor) / factor]
      : node.map(round);
  return { ...geometry, coordinates: round(geometry.coordinates) };
}

/** Đếm tổng số điểm trong geometry — để đo hiệu quả đơn giản hóa. */
export function countPoints(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  let n = 0;
  const walk = (node) => {
    if (typeof node[0] === 'number') n++;
    else node.forEach(walk);
  };
  walk(geometry.coordinates);
  return n;
}
