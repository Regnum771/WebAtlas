# Vùng công tác + OSM waterways + Ranh giới 34 tỉnh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giới hạn 8 layer chuyên đề vào 6 tỉnh vùng Nam Trung Bộ & Tây Nguyên, thay ranh giới GADM cũ bằng ranh giới 34 tỉnh sau sáp nhập, và thay HydroSHEDS bằng OSM waterways để sông/hồ bám đúng thực địa và có tên riêng.

**Architecture:** Lọc tại tầng chuẩn bị dữ liệu (không phải runtime). Một hằng số vùng duy nhất trong `packages/shared` điều khiển mọi script. Các script tải/khám phá/cắt chạy một lần, kết quả commit như generated artifact — CI không phụ thuộc mạng.

**Tech Stack:** Node.js ESM scripts (`.mjs`), TypeScript, Vitest, PostGIS, GeoServer WFS, OpenLayers, Overpass API.

## Global Constraints

- **Vùng công tác:** 6 tỉnh, mã `48` (Đà Nẵng), `51` (Quảng Ngãi), `52` (Gia Lai), `56` (Khánh Hòa), `66` (Đắk Lắk), `68` (Lâm Đồng). Đã xác minh khớp thư mục kho nguồn.
- **Nguồn ranh giới:** `thanglequoc/vietnamese-provinces-database`, MIT, EPSG:4326, raw URL gốc `https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/master/json/geojson/`.
- **Đơn giản hóa hình học bắt buộc:** Douglas–Peucker tolerance `0.0001` + làm tròn toạ độ 5 chữ số thập phân. Không có bước này, dữ liệu xã là 157 MB.
- **Giữ nguyên id layer:** `layer_provinces_2026`, `layer_wards_2026` — đổi sẽ phá `layersState` và test.
- **Quy tắc cắt:** đối tượng còn **một đỉnh** trong vùng thì giữ **nguyên vẹn**, không cắt cụt hình học.
- **Chuỗi `source` phải đổi** khi dữ liệu seed đổi, nếu không `ingestRivers` idempotent sẽ kích hoạt lại version cũ.
- **Không commit dữ liệu OSM thô** — chỉ commit kết quả đã cắt.
- **Attribution ODbL:** "© OpenStreetMap contributors" cho layer sông/hồ.
- Chạy lệnh từ repo root. Test: `npm run test -w @webatlas/web`, `npm run test -w @webatlas/api`. Build: `npm run build -w @webatlas/web`.
- Docker stack phải chạy cho task seed: `cd infra && docker compose ps`.

---

## Task 1: Hằng số vùng công tác

**Files:**
- Create: `packages/shared/src/region.ts`
- Modify: `packages/shared/src/index.ts:19-22`
- Test: `packages/shared/src/region.test.ts`

**Interfaces:**
- Consumes: (không có — task đầu tiên)
- Produces: `REGION_PROVINCE_CODES: readonly string[]`, `REGION_NAME: string`, `isRegionProvince(code: unknown): boolean`. Mọi task sau import từ `@webatlas/shared`.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/shared/src/region.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { REGION_PROVINCE_CODES, REGION_NAME, isRegionProvince } from './region';

describe('region', () => {
  it('gồm đúng 6 tỉnh của vùng Nam Trung Bộ & Tây Nguyên', () => {
    expect(REGION_PROVINCE_CODES).toHaveLength(6);
    expect([...REGION_PROVINCE_CODES].sort()).toEqual(['48', '51', '52', '56', '66', '68']);
  });

  it('mã tỉnh là chuỗi hai ký tự số, giữ số 0 đứng đầu', () => {
    for (const code of REGION_PROVINCE_CODES) {
      expect(code).toMatch(/^\d{2}$/);
    }
  });

  it('isRegionProvince nhận diện đúng trong/ngoài vùng', () => {
    expect(isRegionProvince('48')).toBe(true);
    expect(isRegionProvince('68')).toBe(true);
    expect(isRegionProvince('01')).toBe(false); // Hà Nội
    expect(isRegionProvince('79')).toBe(false); // TP.HCM
  });

  it('isRegionProvince không vỡ với giá trị lạ', () => {
    expect(isRegionProvince(null)).toBe(false);
    expect(isRegionProvince(undefined)).toBe(false);
    expect(isRegionProvince(48)).toBe(false); // số, không phải chuỗi
    expect(isRegionProvince('')).toBe(false);
  });

  it('có tên vùng hiển thị được', () => {
    expect(REGION_NAME).toBe('Nam Trung Bộ & Tây Nguyên');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run src/region.test.ts --root packages/shared`
Expected: FAIL — `Cannot find module './region'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `packages/shared/src/region.ts`:

```ts
/**
 * Vùng công tác của dự án — Nam Trung Bộ & Tây Nguyên theo đơn vị hành chính
 * sau sáp nhập (01/7/2025).
 *
 * Đây là NGUỒN SỰ THẬT DUY NHẤT về phạm vi địa lý: script chuẩn bị dữ liệu,
 * script cắt và các kiểm thử đều đọc từ đây. Đổi vùng = sửa mảng dưới đây rồi
 * chạy lại pipeline dữ liệu.
 *
 * Mã tỉnh là mã đơn vị hành chính chính thức, giữ dạng CHUỖI để không mất số 0
 * đứng đầu (ví dụ '01' = Hà Nội).
 */
export const REGION_PROVINCE_CODES = ['48', '51', '52', '56', '66', '68'] as const;

/** Tên vùng để hiển thị trên giao diện. */
export const REGION_NAME = 'Nam Trung Bộ & Tây Nguyên';

/** Tên tỉnh theo mã — để thông báo lỗi và báo cáo đọc được. */
export const REGION_PROVINCE_NAMES: Record<string, string> = {
  '48': 'Đà Nẵng',
  '51': 'Quảng Ngãi',
  '52': 'Gia Lai',
  '56': 'Khánh Hòa',
  '66': 'Đắk Lắk',
  '68': 'Lâm Đồng',
};

/** Mã tỉnh này có thuộc vùng công tác không? */
export function isRegionProvince(code: unknown): boolean {
  return typeof code === 'string' && (REGION_PROVINCE_CODES as readonly string[]).includes(code);
}
```

Sửa `packages/shared/src/index.ts`, thêm vào cuối (sau dòng 22):

```ts
export * from './region';
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npx vitest run src/region.test.ts --root packages/shared`
Expected: PASS — 5 tests

- [ ] **Step 5: Build lại package shared**

`@webatlas/shared` được resolve qua `dist/`, nên các task sau (test ở Task 4,
script ở Task 9) chỉ thấy export mới sau khi build.

Run: `npm run build -w @webatlas/shared`
Expected: build thành công.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/region.ts packages/shared/src/region.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): hằng số vùng công tác 6 tỉnh Nam Trung Bộ & Tây Nguyên"
```

---

## Task 2: Đơn giản hóa hình học GeoJSON

**Files:**
- Create: `apps/api/scripts/lib/simplify.mjs`
- Test: `apps/api/scripts/lib/simplify.test.mjs`

**Interfaces:**
- Consumes: (không có)
- Produces: `simplifyGeometry(geometry, tolerance)` → geometry mới; `roundCoords(geometry, decimals)` → geometry mới; `countPoints(geometry)` → number. Task 3 dùng cả ba.

**Vì sao cần:** dữ liệu xã thô là 157,3 MB (đo thật trên 6 tỉnh). Mỗi xã ~2.487 điểm ở ~14 chữ số thập phân. Không đơn giản hóa thì trình duyệt treo.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/api/scripts/lib/simplify.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { simplifyGeometry, roundCoords, countPoints } from './simplify.mjs';

// Vòng vuông với nhiều điểm thừa nằm thẳng hàng trên mỗi cạnh.
function squareWithRedundantPoints() {
  const ring = [];
  for (let i = 0; i <= 10; i++) ring.push([i / 10, 0]);
  for (let i = 1; i <= 10; i++) ring.push([1, i / 10]);
  for (let i = 9; i >= 0; i--) ring.push([i / 10, 1]);
  for (let i = 9; i >= 0; i--) ring.push([0, i / 10]);
  return { type: 'Polygon', coordinates: [ring] };
}

describe('simplify', () => {
  it('bỏ điểm thừa thẳng hàng nhưng giữ hình dạng', () => {
    const geom = squareWithRedundantPoints();
    const before = countPoints(geom);
    const out = simplifyGeometry(geom, 0.0001);
    expect(countPoints(out)).toBeLessThan(before / 4);
    // 4 góc vuông phải còn nguyên
    expect(countPoints(out)).toBeGreaterThanOrEqual(5);
  });

  it('giữ vòng khép kín sau khi đơn giản hóa', () => {
    const out = simplifyGeometry(squareWithRedundantPoints(), 0.0001);
    const ring = out.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('không bao giờ tạo vòng dưới 4 điểm (polygon hợp lệ)', () => {
    // Tolerance rất lớn: nếu không có chặn dưới sẽ thành vòng 2 điểm.
    const out = simplifyGeometry(squareWithRedundantPoints(), 10);
    expect(out.coordinates[0].length).toBeGreaterThanOrEqual(4);
  });

  it('xử lý MultiPolygon giữ nguyên cấu trúc lồng nhau', () => {
    const geom = {
      type: 'MultiPolygon',
      coordinates: [squareWithRedundantPoints().coordinates, squareWithRedundantPoints().coordinates],
    };
    const out = simplifyGeometry(geom, 0.0001);
    expect(out.type).toBe('MultiPolygon');
    expect(out.coordinates).toHaveLength(2);
    expect(Array.isArray(out.coordinates[0][0][0])).toBe(true);
  });

  it('xử lý LineString (không khép kín) không thêm điểm', () => {
    const geom = { type: 'LineString', coordinates: [[0, 0], [0.5, 0.00001], [1, 0]] };
    const out = simplifyGeometry(geom, 0.001);
    expect(out.coordinates).toHaveLength(2);
  });

  it('roundCoords làm tròn đúng số chữ số', () => {
    const geom = { type: 'Point', coordinates: [108.123456789, 12.987654321] };
    const out = roundCoords(geom, 5);
    expect(out.coordinates).toEqual([108.12346, 12.98765]);
  });

  it('không sửa geometry gốc (immutable)', () => {
    const geom = squareWithRedundantPoints();
    const before = countPoints(geom);
    simplifyGeometry(geom, 0.0001);
    roundCoords(geom, 5);
    expect(countPoints(geom)).toBe(before);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run scripts/lib/simplify.test.mjs --root apps/api`
Expected: FAIL — `Cannot find module './simplify.mjs'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `apps/api/scripts/lib/simplify.mjs`:

```js
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npx vitest run scripts/lib/simplify.test.mjs --root apps/api`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/lib/simplify.mjs apps/api/scripts/lib/simplify.test.mjs
git commit -m "feat(api): thư viện đơn giản hóa hình học GeoJSON (Douglas-Peucker + làm tròn)"
```

---

## Task 3: Tải ranh giới hành chính mới

**Files:**
- Create: `apps/api/scripts/fetch-boundaries.mjs`
- Create: `apps/web/public/provinces-34.geojson` (generated, commit)
- Create: `apps/web/public/wards-region.geojson` (generated, commit)
- Modify: `README.md` (thêm mục tài liệu)

**Interfaces:**
- Consumes: `REGION_PROVINCE_CODES` (Task 1); `simplifyGeometry`, `roundCoords`, `countPoints` (Task 2)
- Produces: hai file GeoJSON ở `apps/web/public/`. Feature tỉnh có `properties.code`, `properties.name`; feature xã có thêm `properties.provinceCode`. Task 4 và 5 dùng.

- [ ] **Step 1: Viết script**

Tạo `apps/api/scripts/fetch-boundaries.mjs`:

```js
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
```

- [ ] **Step 2: Chạy script**

Run: `node apps/api/scripts/fetch-boundaries.mjs`
Expected: in ra `provinces-34.geojson: 34 tỉnh, ~2 MB` và `wards-region.geojson: 616 xã, ~10 MB`. Chạy mất vài phút (hơn 650 lượt tải).

- [ ] **Step 3: Kiểm chứng đầu ra**

```bash
node -e "
const fs=require('fs');
for (const f of ['provinces-34.geojson','wards-region.geojson']) {
  const p='apps/web/public/'+f;
  const fc=JSON.parse(fs.readFileSync(p,'utf8'));
  console.log(f, fc.features.length, 'features,', (fs.statSync(p).size/1048576).toFixed(1),'MB');
  console.log('  props:', Object.keys(fc.features[0].properties).join(','));
}
"
```

Expected: `provinces-34.geojson 34 features`, `wards-region.geojson 616 features`, tổng dưới 15 MB. Feature xã phải có `provinceCode`.

- [ ] **Step 4: Ghi tài liệu vào README**

Thêm mục sau vào `README.md`, ngay trước mục `## Regenerating HydroSHEDS seed data`:

```markdown
## Regenerating administrative boundaries

`apps/web/public/provinces-34.geojson` (34 tỉnh sau sáp nhập, cả nước) và
`wards-region.geojson` (xã của 6 tỉnh trong vùng công tác) là generated
artifact đã commit — không cần chạy lại để chạy app.

Nguồn: [thanglequoc/vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database)
(MIT), dữ liệu gốc từ NXB Tài nguyên – Môi trường và Bản đồ (Bộ NN&MT).

Chạy lại khi ranh giới hành chính thay đổi:

```bash
node apps/api/scripts/fetch-boundaries.mjs
```

Hình học được đơn giản hóa (Douglas–Peucker tol 0,0001 ≈ 11 m, toạ độ làm tròn
5 chữ số). Bước này bắt buộc: dữ liệu xã thô là 157 MB, sau xử lý còn ~10 MB.
Sai số 11 m nằm dưới nửa pixel ở mức zoom tối đa của app (1:100.000).
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/fetch-boundaries.mjs apps/web/public/provinces-34.geojson apps/web/public/wards-region.geojson README.md
git commit -m "feat(api): tải ranh giới 34 tỉnh sau sáp nhập + xã trong vùng"
```

---

## Task 4: Kiểm thử dữ liệu ranh giới

**Files:**
- Create: `apps/web/src/features/map/model/boundaries.test.ts`

**Interfaces:**
- Consumes: `provinces-34.geojson`, `wards-region.geojson` (Task 3); `REGION_PROVINCE_CODES` (Task 1)
- Produces: (chỉ kiểm thử)

**Vì sao tách riêng:** dữ liệu là generated artifact, cần chốt hợp đồng để lần tải lại sau không âm thầm phá app.

- [ ] **Step 1: Viết test**

Tạo `apps/web/src/features/map/model/boundaries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { REGION_PROVINCE_CODES } from '@webatlas/shared';

const publicDir = resolve(__dirname, '../../../../public');
const load = (name: string) =>
  JSON.parse(readFileSync(resolve(publicDir, name), 'utf8')) as {
    type: string;
    features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }>;
  };

describe('ranh giới hành chính', () => {
  it('provinces-34.geojson có đúng 34 tỉnh sau sáp nhập', () => {
    const fc = load('provinces-34.geojson');
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(34);
  });

  it('mọi tỉnh đều có mã và tên', () => {
    for (const f of load('provinces-34.geojson').features) {
      expect(typeof f.properties.code).toBe('string');
      expect(typeof f.properties.name).toBe('string');
      expect((f.properties.name as string).length).toBeGreaterThan(0);
    }
  });

  it('6 tỉnh của vùng đều có mặt trong dữ liệu tỉnh', () => {
    const codes = new Set(load('provinces-34.geojson').features.map((f) => f.properties.code));
    for (const code of REGION_PROVINCE_CODES) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it('wards-region.geojson chỉ chứa xã thuộc 6 tỉnh trong vùng', () => {
    const fc = load('wards-region.geojson');
    expect(fc.features.length).toBeGreaterThan(0);
    const region = new Set<string>(REGION_PROVINCE_CODES);
    for (const f of fc.features) {
      expect(region.has(f.properties.provinceCode as string)).toBe(true);
    }
  });

  it('mọi tỉnh trong vùng đều có ít nhất một xã', () => {
    const seen = new Set(load('wards-region.geojson').features.map((f) => f.properties.provinceCode));
    for (const code of REGION_PROVINCE_CODES) {
      expect(seen.has(code)).toBe(true);
    }
  });

  it('toạ độ nằm trong phạm vi Việt Nam (EPSG:4326, lon/lat)', () => {
    const fc = load('provinces-34.geojson');
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const walk = (n: any): void => {
      if (typeof n[0] === 'number') {
        minLon = Math.min(minLon, n[0]); maxLon = Math.max(maxLon, n[0]);
        minLat = Math.min(minLat, n[1]); maxLat = Math.max(maxLat, n[1]);
      } else n.forEach(walk);
    };
    fc.features.forEach((f) => walk(f.geometry.coordinates));
    // Bao gồm cả Hoàng Sa/Trường Sa nên biên đông vươn xa hơn đất liền.
    expect(minLon).toBeGreaterThan(100);
    expect(maxLon).toBeLessThan(120);
    expect(minLat).toBeGreaterThan(5);
    expect(maxLat).toBeLessThan(25);
  });

  it('dung lượng đủ nhỏ để nạp vào trình duyệt', () => {
    // Dữ liệu xã thô là 157 MB; đây là chốt chặn cho bước đơn giản hóa.
    const wardMb = statSync(resolve(publicDir, 'wards-region.geojson')).size / 1048576;
    const provinceMb = statSync(resolve(publicDir, 'provinces-34.geojson')).size / 1048576;
    expect(wardMb).toBeLessThan(20);
    expect(provinceMb).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận pass**

Run: `npx vitest run src/features/map/model/boundaries.test.ts --root apps/web`
Expected: PASS — 7 tests

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/map/model/boundaries.test.ts
git commit -m "test(web): hợp đồng dữ liệu ranh giới hành chính mới"
```

---

## Task 5: Frontend chuyển sang ranh giới mới

**Files:**
- Modify: `apps/web/src/features/map/model/MapModel.ts:99-101`
- Delete: `apps/web/public/gadm41_VNM_1.geojson`, `apps/web/public/gadm41_VNM_3.geojson`
- Modify: `apps/api/scripts/clip-to-vietnam.mjs:23` (đường dẫn ranh giới)

**Interfaces:**
- Consumes: `provinces-34.geojson`, `wards-region.geojson` (Task 3)
- Produces: bản đồ vẽ ranh giới mới. Id layer **không đổi**.

- [ ] **Step 1: Đổi đường dẫn dữ liệu trong MapModel**

Trong `apps/web/src/features/map/model/MapModel.ts`, thay hai dòng 99 và 101:

```ts
    const provincesLayer = createVectorLayerFromUrl('layer_provinces_2026', './gadm41_VNM_1.geojson', provincesStyle);

    const wardsLayer = createVectorLayerFromUrl('layer_wards_2026', './gadm41_VNM_3.geojson', wardsStyle);
```

thành:

```ts
    // Ranh giới sau sáp nhập (01/7/2025): 34 tỉnh cả nước; xã chỉ có trong vùng
    // công tác — zoom ra ngoài vùng sẽ thấy ranh giới tỉnh nhưng không có xã.
    const provincesLayer = createVectorLayerFromUrl('layer_provinces_2026', './provinces-34.geojson', provincesStyle);

    const wardsLayer = createVectorLayerFromUrl('layer_wards_2026', './wards-region.geojson', wardsStyle);
```

- [ ] **Step 2: Chuyển clip-to-vietnam.mjs sang nguồn ranh giới mới**

Trong `apps/api/scripts/clip-to-vietnam.mjs`, thay dòng:

```js
const boundaryPath = path.join(repoRoot, 'apps/web/public/gadm41_VNM_1.geojson');
```

thành:

```js
const boundaryPath = path.join(repoRoot, 'apps/web/public/provinces-34.geojson');
```

- [ ] **Step 3: Xóa dữ liệu GADM không còn dùng**

```bash
git rm apps/web/public/gadm41_VNM_1.geojson apps/web/public/gadm41_VNM_3.geojson
```

- [ ] **Step 4: Xác nhận không còn tham chiếu GADM**

Run: `grep -rn "gadm41" --include=*.ts --include=*.tsx --include=*.mjs --include=*.md apps/ packages/ README.md | grep -v node_modules`
Expected: không có kết quả nào ngoài tài liệu lịch sử trong `docs/`. Nếu còn trong `apps/` hoặc `packages/`, sửa nốt.

- [ ] **Step 5: Chạy test và build**

Run: `npm run test -w @webatlas/web && npm run build -w @webatlas/web`
Expected: toàn bộ test PASS, build thành công.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/model/MapModel.ts apps/api/scripts/clip-to-vietnam.mjs apps/web/public/
git commit -m "feat(web): dùng ranh giới 34 tỉnh sau sáp nhập, gỡ GADM"
```

---

## Task 6: Tải và khám phá dữ liệu OSM waterways

**Files:**
- Create: `apps/api/scripts/lib/overpass.mjs`
- Create: `apps/api/scripts/fetch-osm-waterways.mjs`
- Create: `apps/api/scripts/explore-osm.mjs`

**Interfaces:**
- Consumes: `REGION_PROVINCE_CODES` (Task 1), `provinces-34.geojson` (Task 3)
- Produces: `overpassQuery(query)` trong `lib/overpass.mjs`; hai file thô **không commit** ở `apps/api/scripts/.osm-cache/`: `osm-waterways-raw.geojson`, `osm-water-raw.geojson`. Task 7 tiêu thụ.

**Vì sao tải rộng:** nếu chỉ tải đúng các tag đã định thì không phát hiện được gì mới. Khảo sát ô mẫu đã cho thấy `ditch` và `waterway=dam` đáng quan tâm mà thiết kế ban đầu bỏ sót.

- [ ] **Step 1: Viết client Overpass có luân phiên endpoint**

Tạo `apps/api/scripts/lib/overpass.mjs`:

```js
/**
 * Client Overpass API tối giản, có thử lại và luân phiên máy chủ.
 *
 * Overpass công cộng hay quá tải — trong lúc khảo sát đã gặp lỗi
 * "Dispatcher_Client::request_read_and_idx::timeout" trên endpoint chính và
 * phải chuyển sang máy chủ dự phòng. Vì vậy mọi truy vấn đều phải chịu được
 * lỗi tạm thời.
 */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Chạy một truy vấn Overpass QL, trả về JSON đã parse.
 * Thử lần lượt từng endpoint, mỗi endpoint tối đa `attemptsPerEndpoint` lần.
 */
export async function overpassQuery(query, { attemptsPerEndpoint = 2 } = {}) {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= attemptsPerEndpoint; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: query,
          headers: { 'Content-Type': 'text/plain', 'User-Agent': 'webatlas-osm-fetch' },
        });
        const text = await res.text();
        // Overpass trả HTML khi quá tải, dù mã HTTP là 200.
        if (!text.trimStart().startsWith('{')) {
          throw new Error(`phản hồi không phải JSON (máy chủ quá tải?): ${text.slice(0, 120)}`);
        }
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        const wait = attempt * 5000;
        console.warn(`  ! ${endpoint} lần ${attempt}: ${err.message.slice(0, 100)} — chờ ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`Overpass thất bại trên mọi endpoint: ${lastError?.message}`);
}

/** Bbox của một FeatureCollection -> [minLat, minLon, maxLat, maxLon] (thứ tự Overpass). */
export function bboxOf(features) {
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  const walk = (n) => {
    if (typeof n[0] === 'number') {
      minLon = Math.min(minLon, n[0]); maxLon = Math.max(maxLon, n[0]);
      minLat = Math.min(minLat, n[1]); maxLat = Math.max(maxLat, n[1]);
    } else n.forEach(walk);
  };
  for (const f of features) walk(f.geometry.coordinates);
  return [minLat, minLon, maxLat, maxLon];
}
```

- [ ] **Step 2: Viết script tải**

Tạo `apps/api/scripts/fetch-osm-waterways.mjs`:

```js
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
```

- [ ] **Step 3: Viết script khám phá**

Tạo `apps/api/scripts/explore-osm.mjs`:

```js
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
```

- [ ] **Step 4: Chạy tải rồi khám phá**

Run:
```bash
node apps/api/scripts/fetch-osm-waterways.mjs && node apps/api/scripts/explore-osm.mjs
```

Expected: bảng phân bố tag. Dựa trên ô mẫu 1°×1° đã khảo sát, kỳ vọng thấy `stream`, `river`, `dam`, `canal`, `ditch`, `weir` ở phần waterway và `water`, `reservoir`, `pond`, `lake` ở phần mặt nước. Nếu xuất hiện giá trị đáng kể chưa có trong bảng ánh xạ ở Task 7, dừng lại và báo cho người dùng trước khi tiếp tục.

- [ ] **Step 5: Chặn cache khỏi git**

Thêm vào `.gitignore`:

```
# Dữ liệu OSM thô — chỉ commit bản đã cắt theo vùng
apps/api/scripts/.osm-cache/
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/lib/overpass.mjs apps/api/scripts/fetch-osm-waterways.mjs apps/api/scripts/explore-osm.mjs .gitignore
git commit -m "feat(api): tải + khám phá dữ liệu OSM waterways cho vùng công tác"
```

---

## Task 7: Ánh xạ tag OSM sang schema

**Files:**
- Create: `packages/shared/src/osm-water.ts`
- Modify: `packages/shared/src/index.ts` (thêm export)
- Test: `packages/shared/src/osm-water.test.ts`

**Interfaces:**
- Consumes: (không có)
- Produces: `waterwayToStreamOrder(waterway: unknown): number | null`, `RIVER_WATERWAY_VALUES: readonly string[]`, `osmWaterToLakeType(props): string | null`, `STREAM_ORDER_LABELS: Record<number, string>`. Task 8 và 10 dùng.

**Vì sao ở `packages/shared`:** cả seed (API) lẫn popup (web) đều cần cùng một bảng ánh xạ. Đặt một chỗ để không lệch nhau.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/shared/src/osm-water.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  waterwayToStreamOrder,
  osmWaterToLakeType,
  RIVER_WATERWAY_VALUES,
  STREAM_ORDER_LABELS,
} from './osm-water';

describe('ánh xạ OSM waterway -> stream_order', () => {
  it('phân cấp sông chính > kênh > suối > mương', () => {
    expect(waterwayToStreamOrder('river')).toBe(5);
    expect(waterwayToStreamOrder('canal')).toBe(4);
    expect(waterwayToStreamOrder('stream')).toBe(2);
    expect(waterwayToStreamOrder('ditch')).toBe(1);
  });

  it('mương tiêu (drain) cùng hạng với mương dẫn (ditch)', () => {
    expect(waterwayToStreamOrder('drain')).toBe(1);
  });

  it('loại trừ công trình — không phải dòng chảy', () => {
    expect(waterwayToStreamOrder('dam')).toBeNull();
    expect(waterwayToStreamOrder('weir')).toBeNull();
    expect(waterwayToStreamOrder('waterfall')).toBeNull();
  });

  it('không vỡ với tag lạ hoặc thiếu', () => {
    expect(waterwayToStreamOrder('tidal_channel')).toBeNull();
    expect(waterwayToStreamOrder(undefined)).toBeNull();
    expect(waterwayToStreamOrder(null)).toBeNull();
    expect(waterwayToStreamOrder(42)).toBeNull();
  });

  it('RIVER_WATERWAY_VALUES khớp với các giá trị có stream_order', () => {
    expect(RIVER_WATERWAY_VALUES.length).toBeGreaterThan(0);
    for (const v of RIVER_WATERWAY_VALUES) {
      expect(waterwayToStreamOrder(v)).not.toBeNull();
    }
    expect(RIVER_WATERWAY_VALUES).toHaveLength(5);
  });

  it('mỗi bậc đều có nhãn tiếng Việt', () => {
    for (const v of RIVER_WATERWAY_VALUES) {
      const order = waterwayToStreamOrder(v)!;
      expect(STREAM_ORDER_LABELS[order]).toBeTruthy();
    }
    expect(STREAM_ORDER_LABELS[5]).toBe('Sông chính');
  });
});

describe('ánh xạ OSM mặt nước -> lake_type', () => {
  it('nhận diện hồ chứa từ cả landuse lẫn water', () => {
    expect(osmWaterToLakeType({ landuse: 'reservoir' })).toBe('Hồ chứa');
    expect(osmWaterToLakeType({ water: 'reservoir' })).toBe('Hồ chứa');
  });

  it('phân biệt hồ tự nhiên, ao, bể chứa và mặt nước chung', () => {
    expect(osmWaterToLakeType({ water: 'lake' })).toBe('Hồ tự nhiên');
    expect(osmWaterToLakeType({ water: 'pond' })).toBe('Ao');
    expect(osmWaterToLakeType({ water: 'basin' })).toBe('Bể chứa');
    expect(osmWaterToLakeType({ natural: 'water' })).toBe('Mặt nước');
  });

  it('LOẠI dòng chảy vẽ dạng vùng — chúng đã nằm trong layer rivers', () => {
    // water=river là mặt nước của chính con sông đã có tim tuyến; đưa vào layer
    // hồ sẽ khiến một con sông xuất hiện ở cả hai layer.
    expect(osmWaterToLakeType({ natural: 'water', water: 'river' })).toBeNull();
    expect(osmWaterToLakeType({ natural: 'water', water: 'canal' })).toBeNull();
    expect(osmWaterToLakeType({ natural: 'water', water: 'stream' })).toBeNull();
  });

  it('landuse=reservoir thắng water=lake khi cả hai cùng có', () => {
    expect(osmWaterToLakeType({ landuse: 'reservoir', water: 'lake' })).toBe('Hồ chứa');
  });

  it('trả null khi không phải mặt nước', () => {
    expect(osmWaterToLakeType({ building: 'yes' })).toBeNull();
    expect(osmWaterToLakeType({})).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run src/osm-water.test.ts --root packages/shared`
Expected: FAIL — `Cannot find module './osm-water'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `packages/shared/src/osm-water.ts`:

```ts
/**
 * Ánh xạ tag OSM sang schema thủy văn của dự án.
 *
 * OSM không có bậc Strahler như HydroRIVERS. Thay vào đó ta phân cấp theo LOẠI
 * dòng chảy và ghi vào chính cột `stream_order` sẵn có — nhờ vậy không phải đổi
 * schema, không đổi LAYER_ATTRIBUTE_MAP, và độ rộng nét vẽ hoạt động như cũ.
 *
 * LƯU Ý NGỮ NGHĨA: con số trong `stream_order` giờ KHÔNG còn là bậc Strahler.
 * Nó là hạng theo loại. Vì vậy popup hiển thị nhãn loại (STREAM_ORDER_LABELS)
 * thay vì "Cấp N".
 */

/** waterway -> hạng dùng cho độ rộng nét. Chỉ dòng chảy, không gồm công trình. */
const WATERWAY_ORDER: Record<string, number> = {
  river: 5,   // sông chính
  canal: 4,   // kênh đào (công trình thủy lợi)
  stream: 2,  // suối
  ditch: 1,   // mương dẫn
  drain: 1,   // mương tiêu — cùng hạng với ditch (khảo sát OSM: 245 đối tượng trong vùng)
};

/** Nhãn tiếng Việt cho từng hạng — dùng ở popup và chú giải. */
export const STREAM_ORDER_LABELS: Record<number, string> = {
  5: 'Sông chính',
  4: 'Kênh đào',
  2: 'Suối',
  1: 'Mương', // gồm cả ditch (mương dẫn) và drain (mương tiêu)
};

/** Các giá trị `waterway` được nhận vào layer sông. */
export const RIVER_WATERWAY_VALUES = Object.keys(WATERWAY_ORDER) as readonly string[];

/**
 * Hạng dòng chảy từ tag `waterway`, hoặc null nếu không phải dòng chảy
 * (dam/weir/waterfall là công trình; tag lạ bị bỏ qua).
 */
export function waterwayToStreamOrder(waterway: unknown): number | null {
  if (typeof waterway !== 'string') return null;
  return WATERWAY_ORDER[waterway] ?? null;
}

/**
 * Loại mặt nước từ tag OSM, hoặc null nếu không phải thủy vực đứng.
 * `landuse=reservoir` được ưu tiên vì nó khẳng định hồ nhân tạo.
 *
 * CỐ Ý LOẠI `water=river` (600 đối tượng trong vùng): đó là MẶT NƯỚC của chính
 * những con sông đã có tim tuyến trong layer `rivers`. Đưa vào layer hồ sẽ khiến
 * một con sông xuất hiện ở cả hai layer, và click vào có thể ra popup sai layer.
 * Tương tự với `water=canal` / `water=stream`.
 */
export function osmWaterToLakeType(props: Record<string, unknown>): string | null {
  // Dòng chảy vẽ dạng vùng — đã có trong layer rivers, không nhân bản sang lakes.
  if (props.water === 'river' || props.water === 'canal' || props.water === 'stream') return null;
  if (props.landuse === 'reservoir' || props.water === 'reservoir') return 'Hồ chứa';
  if (props.water === 'lake') return 'Hồ tự nhiên';
  if (props.water === 'pond') return 'Ao';
  if (props.water === 'basin') return 'Bể chứa';
  if (props.natural === 'water') return 'Mặt nước';
  return null;
}
```

Thêm vào cuối `packages/shared/src/index.ts`:

```ts
export * from './osm-water';
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npx vitest run src/osm-water.test.ts --root packages/shared`
Expected: PASS — 9 tests

- [ ] **Step 5: Build lại package shared**

`@webatlas/shared` được resolve qua `dist/` (xem `exports` trong `package.json`),
nên script `.mjs` ở Task 9 chỉ import được sau khi build.

Run: `npm run build -w @webatlas/shared`
Expected: build thành công.

Xác nhận export đã có mặt:

```bash
node -e "import('@webatlas/shared').then(m=>console.log('waterwayToStreamOrder:', typeof m.waterwayToStreamOrder, '| osmWaterToLakeType:', typeof m.osmWaterToLakeType, '| REGION_PROVINCE_CODES:', m.REGION_PROVINCE_CODES))"
```

Expected: `waterwayToStreamOrder: function | osmWaterToLakeType: function | REGION_PROVINCE_CODES: [ '48', '51', '52', '56', '66', '68' ]`

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/osm-water.ts packages/shared/src/osm-water.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): ánh xạ tag OSM waterway/water sang schema thủy văn"
```

---

## Task 8: Cắt dữ liệu theo vùng

**Files:**
- Create: `apps/api/scripts/lib/regionClip.mjs`
- Create: `apps/api/scripts/clip-to-region.mjs`
- Delete: `apps/api/scripts/clip-to-vietnam.mjs`
- Test: `apps/api/scripts/lib/regionClip.test.mjs`

**Interfaces:**
- Consumes: `provinces-34.geojson` (Task 3)
- Produces: `buildRegionRings(provincesGeoJson, codes)` → mảng polygon có bbox; `featureIntersectsRegion(feature, rings)` → boolean. Task 9 dùng.

**Vì sao thay thế `clip-to-vietnam.mjs`:** logic giống hệt, chỉ khác ranh giới là 6 tỉnh thay vì cả nước. Giữ cả hai là trùng lặp.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/api/scripts/lib/regionClip.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { buildRegionRings, featureIntersectsRegion } from './regionClip.mjs';

// Hai ô vuông rời nhau, giả lập hai tỉnh.
const fakeProvinces = {
  type: 'FeatureCollection',
  features: [
    {
      properties: { code: '48', name: 'Tỉnh A' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
    },
    {
      properties: { code: '51', name: 'Tỉnh B' },
      geometry: { type: 'MultiPolygon', coordinates: [[[[5, 5], [7, 5], [7, 7], [5, 7], [5, 5]]]] },
    },
    {
      properties: { code: '99', name: 'Ngoài vùng' },
      geometry: { type: 'Polygon', coordinates: [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]] },
    },
  ],
};

const rings = buildRegionRings(fakeProvinces, ['48', '51']);

describe('regionClip', () => {
  it('chỉ dựng ranh giới từ các tỉnh được chỉ định', () => {
    expect(rings).toHaveLength(2);
  });

  it('báo lỗi rõ ràng khi thiếu mã tỉnh', () => {
    expect(() => buildRegionRings(fakeProvinces, ['48', '00'])).toThrow(/00/);
  });

  it('giữ điểm nằm trong vùng', () => {
    const f = { geometry: { type: 'Point', coordinates: [1, 1] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('loại điểm nằm ngoài vùng', () => {
    const f = { geometry: { type: 'Point', coordinates: [21, 21] } };
    expect(featureIntersectsRegion(f, rings)).toBe(false);
  });

  it('giữ NGUYÊN VẸN đối tượng vắt ngang biên giới vùng', () => {
    // Đường bắt đầu trong tỉnh A, kết thúc bên ngoài — phải được giữ.
    const f = { geometry: { type: 'LineString', coordinates: [[1, 1], [50, 50]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('nhận diện qua bất kỳ đỉnh nào, kể cả đỉnh cuối', () => {
    const f = { geometry: { type: 'LineString', coordinates: [[50, 50], [40, 40], [6, 6]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('loại đối tượng hoàn toàn nằm ngoài', () => {
    const f = { geometry: { type: 'LineString', coordinates: [[30, 30], [40, 40]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(false);
  });

  it('xử lý MultiPolygon lồng nhiều tầng', () => {
    const f = { geometry: { type: 'MultiPolygon', coordinates: [[[[6, 6], [6.5, 6], [6.5, 6.5], [6, 6]]]] } };
    expect(featureIntersectsRegion(f, rings)).toBe(true);
  });

  it('không vỡ khi feature thiếu geometry', () => {
    expect(featureIntersectsRegion({ geometry: null }, rings)).toBe(false);
    expect(featureIntersectsRegion({}, rings)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run scripts/lib/regionClip.test.mjs --root apps/api`
Expected: FAIL — `Cannot find module './regionClip.mjs'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `apps/api/scripts/lib/regionClip.mjs`:

```js
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npx vitest run scripts/lib/regionClip.test.mjs --root apps/api`
Expected: PASS — 9 tests

- [ ] **Step 5: Viết script CLI**

Tạo `apps/api/scripts/clip-to-region.mjs`:

```js
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
```

- [ ] **Step 6: Xóa script cũ**

```bash
git rm apps/api/scripts/clip-to-vietnam.mjs
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/scripts/lib/regionClip.mjs apps/api/scripts/lib/regionClip.test.mjs apps/api/scripts/clip-to-region.mjs
git commit -m "feat(api): cắt dữ liệu chuyên đề theo vùng công tác, thay clip-to-vietnam"
```

> **Thứ tự quan trọng:** script này ghi đè `thuydienvietnam.geojson` tại chỗ.
> Báo cáo đối chiếu đập (Task 13) cần danh mục ĐẦY ĐỦ để đếm đúng 19 đập thiếu
> toạ độ, nên **Task 13 phải chạy TRƯỚC** lần cắt đầu tiên, hoặc chạy trên bản
> gốc lấy từ `git show HEAD:apps/web/public/thuydienvietnam.geojson`.

---

## Task 9: Chuyển OSM thành file seed

**Files:**
- Create: `apps/api/scripts/build-osm-seeds.mjs`
- Create: `apps/api/src/db/seeds/data/osm-rivers-region.geojson` (generated, commit)
- Create: `apps/api/src/db/seeds/data/osm-lakes-region.geojson` (generated, commit)
- Modify: `README.md`

**Interfaces:**
- Consumes: cache thô (Task 6); `waterwayToStreamOrder`, `osmWaterToLakeType` (Task 7); `clip-to-region.mjs` (Task 8)
- Produces: hai file seed. Feature sông có `properties`: `osmId`, `name`, `waterway`, `streamOrder`, `lengthM` (mét, tính từ hình học). Feature hồ có: `osmId`, `name`, `lakeType`. Task 10 tiêu thụ.

- [ ] **Step 1: Viết script**

Tạo `apps/api/scripts/build-osm-seeds.mjs`:

```js
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
```

- [ ] **Step 2: Chạy build rồi cắt**

Run:
```bash
node apps/api/scripts/build-osm-seeds.mjs && node apps/api/scripts/clip-to-region.mjs
```

Expected: build in ra số lượng và tỷ lệ có tên; clip in ra số bị bỏ cho hai file OSM. Số cuối cùng phải lớn hơn 0 cho cả hai.

- [ ] **Step 3: Kiểm chứng đầu ra**

```bash
node -e "
const fs=require('fs');
for (const f of ['osm-rivers-region.geojson','osm-lakes-region.geojson']) {
  const p='apps/api/src/db/seeds/data/'+f;
  const fc=JSON.parse(fs.readFileSync(p,'utf8'));
  const named=fc.features.filter(x=>x.properties.name).length;
  console.log(f, fc.features.length, 'features,', named, 'có tên,', (fs.statSync(p).size/1048576).toFixed(1),'MB');
  console.log('  props mẫu:', JSON.stringify(fc.features[0].properties));
}
"
```

Expected: cả hai file có features > 0 và số có tên > 0. Đây là điểm mấu chốt của cả thay đổi — nguồn cũ có 0 tên.

Kiểm tra thêm độ dài tính được là hợp lý:

```bash
node -e "
const fc=JSON.parse(require('fs').readFileSync('apps/api/src/db/seeds/data/osm-rivers-region.geojson','utf8'));
const lens=fc.features.map(f=>f.properties.lengthM);
const bad=lens.filter(v=>typeof v!=='number'||!isFinite(v)||v<=0).length;
console.log('độ dài không hợp lệ:',bad);
console.log('ngắn nhất',Math.min(...lens),'m | dài nhất',Math.max(...lens),'m');
"
```

Expected: `độ dài không hợp lệ: 0`. Đoạn dài nhất phải dưới ~500.000 m (500 km) — lớn hơn nghĩa là có lỗi tính toán.

- [ ] **Step 4: Ghi tài liệu vào README**

Thêm vào `README.md`, sau mục "Regenerating administrative boundaries":

```markdown
## Regenerating OSM water data

`apps/api/src/db/seeds/data/osm-rivers-region.geojson` và
`osm-lakes-region.geojson` là generated artifact đã commit — không cần chạy lại
để chạy app.

Nguồn: OpenStreetMap qua Overpass API, giấy phép **ODbL** (bắt buộc ghi công
"© OpenStreetMap contributors").

Chạy lại khi muốn cập nhật dữ liệu OSM:

```bash
node apps/api/scripts/fetch-osm-waterways.mjs   # tải thô (không commit)
node apps/api/scripts/explore-osm.mjs           # xem phân bố tag đã đổi chưa
node apps/api/scripts/build-osm-seeds.mjs       # chuyển thành file seed
node apps/api/scripts/clip-to-region.mjs        # cắt xuống vùng công tác
```

Luôn chạy `explore-osm.mjs` và đối chiếu với bảng ánh xạ trong
`packages/shared/src/osm-water.ts`: nếu OSM xuất hiện giá trị tag mới đáng kể,
cập nhật bảng trước khi nạp.
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/build-osm-seeds.mjs apps/api/src/db/seeds/data/osm-rivers-region.geojson apps/api/src/db/seeds/data/osm-lakes-region.geojson README.md
git commit -m "feat(api): file seed sông/hồ từ OSM đã cắt theo vùng"
```

---

## Task 10: Nạp OSM vào DB

**Files:**
- Modify: `apps/api/src/db/seeds/registry.ts:45-61` (rivers), `:94-108` (lakes)
- Modify: `apps/api/src/db/seeds/ingestRivers.ts:9-26`
- Modify: `apps/api/src/db/seeds/seed.test.ts:101`
- Modify: `apps/api/src/modules/versions/integration.test.ts:93`

**Interfaces:**
- Consumes: file seed (Task 9)
- Produces: `water.rivers` và `water.lakes` chứa dữ liệu OSM dưới version active. Chuỗi source: `'OSM waterways'` và `'OSM water bodies'`.

**Bẫy đã biết:** `ingestRivers` idempotent theo `source` — giữ nguyên chuỗi cũ thì nó kích hoạt lại version cũ thay vì nạp dữ liệu mới. Bắt buộc phải đổi.

- [ ] **Step 1: Sửa registry cho lakes**

Trong `apps/api/src/db/seeds/registry.ts`, thay khối `table: 'lakes'` (dòng 94-108):

```ts
  {
    table: 'lakes',
    file: resolve(seedData, 'hydrolakes-vn.geojson'),
    // "vn-clip": đã lọc xuống đúng lãnh thổ VN (apps/api/scripts/clip-to-vietnam.mjs).
    source: 'HydroLAKES v10 vn-clip',
    multiPolygon: true,
    columns: (p) => ({
      external_id: p.Hylak_id,
      name: p.Lake_name,
      lake_type: lakeTypeLabel(p.Lake_type),
      area_km2: p.Lake_area,
      volume_mcm: p.Vol_total,
      shore_len_km: p.Shore_len,
    }),
  },
```

bằng:

```ts
  {
    table: 'lakes',
    file: resolve(seedData, 'osm-lakes-region.geojson'),
    // OSM có tên hồ (HydroLAKES không có) và độ phủ cao hơn nhiều.
    // Đánh đổi: mất Vol_total/Shore_len — OSM không có hai trường này.
    source: 'OSM water bodies',
    multiPolygon: true,
    columns: (p) => ({
      external_id: p.osmId,
      name: p.name,
      lake_type: p.lakeType,
      area_km2: null,
      volume_mcm: null,
      shore_len_km: null,
    }),
  },
```

- [ ] **Step 2: Gỡ import không còn dùng**

Trong `apps/api/src/db/seeds/registry.ts`, xóa dòng 4:

```ts
import { lakeTypeLabel } from './lakeType';
```

`lakeType.ts` giữ lại (dữ liệu HydroLAKES vẫn có thể được nạp lại từ file seed cũ).

- [ ] **Step 3: Sửa ingestRivers sang OSM**

Trong `apps/api/src/db/seeds/ingestRivers.ts`, thay dòng 9-12:

```ts
// Bumped when the seed file's contents change so the idempotency check below sees a
// genuinely new ingest instead of reactivating the stale version. "vn-clip" = lọc xuống
// đúng lãnh thổ Việt Nam (xem apps/api/scripts/clip-to-vietnam.mjs).
const HYDRORIVERS_SOURCE = 'HydroRIVERS v10 vn-clip';
```

bằng:

```ts
// Đổi chuỗi này mỗi khi nội dung file seed đổi: hàm ingest dưới đây idempotent
// THEO SOURCE, nên giữ nguyên chuỗi sẽ khiến nó kích hoạt lại version cũ thay vì
// nạp dữ liệu mới.
const HYDRORIVERS_SOURCE = 'OSM waterways';
```

- [ ] **Step 4: Sửa layer definition trong ingestRivers**

Trong cùng file, thay khối `RIVERS_HYDRO_LAYER` (dòng 12-26):

```ts
// HydroRIVERS → the existing `rivers` columns. No per-segment names in the source.
const RIVERS_HYDRO_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, 'data/hydrorivers-vn.geojson'),
  source: HYDRORIVERS_SOURCE,
  multiLine: true,
  columns: (p) => ({
    external_id: p.HYRIV_ID,
    code: null,
```

bằng:

```ts
// OSM waterways → các cột `rivers` sẵn có. Khác HydroRIVERS: OSM CÓ tên sông,
// và `stream_order` giờ là hạng theo loại chứ không phải bậc Strahler.
const RIVERS_HYDRO_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, 'data/osm-rivers-region.geojson'),
  source: HYDRORIVERS_SOURCE,
  multiLine: true,
  columns: (p) => ({
    external_id: p.osmId,
    code: p.waterway,
```

Sau đó xem phần còn lại của khối `columns` và sửa cho khớp bảng dưới (đọc dòng 17-26 hiện tại rồi thay các trường tương ứng):

```ts
    name: p.name,
    stream_order: p.streamOrder,
    // Độ dài do build-osm-seeds.mjs tính từ hình học (OSM không có sẵn trường này).
    length_m: p.lengthM,
  }),
};
```

- [ ] **Step 5: Cập nhật test cho chuỗi source mới**

Trong `apps/api/src/db/seeds/seed.test.ts` dòng 101, thay:

```ts
    expect(ver[0]).toMatchObject({ source: 'HydroLAKES v10 vn-clip', is_active: true });
```

bằng:

```ts
    expect(ver[0]).toMatchObject({ source: 'OSM water bodies', is_active: true });
```

Trong `apps/api/src/modules/versions/integration.test.ts` dòng 93, thay:

```ts
    expect(v).toMatchObject({ kind: 'ingest', source: 'HydroRIVERS v10 vn-clip', isActive: true });
```

bằng:

```ts
    expect(v).toMatchObject({ kind: 'ingest', source: 'OSM waterways', isActive: true });
```

- [ ] **Step 6: Nạp dữ liệu**

Run:
```bash
cd infra && docker compose ps && cd ..
npm run seed -w @webatlas/api && npm run ingest:rivers -w @webatlas/api
```

Expected: `seeded water.lakes: N features` với N > 0, rồi `rivers ... version <uuid>: M features` với M > 0.

**Lưu ý:** `npm run seed` nạp thuyhe làm rivers v1 rồi kích hoạt, ghi đè bản OSM. Vì vậy `ingest:rivers` PHẢI chạy sau, không được đảo thứ tự.

- [ ] **Step 7: Kiểm chứng DB và WFS**

```bash
cd infra && docker compose exec -T db sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"SELECT layer_key, source, feature_count, is_active FROM app.dataset_versions WHERE layer_key IN ('rivers','lakes') AND is_active;\"" && cd ..
for L in rivers lakes; do
  echo -n "$L: "
  curl -s "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:$L&resultType=hits" | grep -oE 'numberMatched="[0-9]+"'
done
```

Expected: source là `OSM waterways` / `OSM water bodies`; số WFS khớp `feature_count` trong DB.

- [ ] **Step 8: Chạy test API**

Run: `npm run test -w @webatlas/api`
Expected: toàn bộ PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db/seeds/registry.ts apps/api/src/db/seeds/ingestRivers.ts apps/api/src/db/seeds/seed.test.ts apps/api/src/modules/versions/integration.test.ts
git commit -m "feat(api): nạp sông/hồ từ OSM, thay dữ liệu HydroSHEDS"
```

---

## Task 11: Xóa version HydroSHEDS khỏi DB

**Files:**
- Create: `apps/api/scripts/prune-hydrosheds-versions.mjs`

**Interfaces:**
- Consumes: DB đã nạp OSM (Task 10)
- Produces: bảng `app.dataset_versions` không còn version HydroSHEDS

**Quyết định của người dùng:** xóa hẳn bản cũ thay vì giữ để rollback. Giảm nhẹ: **giữ file seed trong git** (`hydrorivers-vn.geojson`, `hydrolakes-vn.geojson`), chỉ xóa dữ liệu trong DB — nếu OSM có vấn đề vẫn dựng lại được.

- [ ] **Step 1: Viết script**

Tạo `apps/api/scripts/prune-hydrosheds-versions.mjs`:

```js
/**
 * Xóa các version HydroSHEDS/thuyhe khỏi DB sau khi đã chuyển sang OSM.
 *
 * An toàn: TỪ CHỐI xóa nếu version đó đang active, để không bao giờ xoá mất dữ
 * liệu đang được phục vụ.
 *
 * File seed vẫn còn trong git — nếu cần quay lại, chạy lại seed/ingest.
 *
 * Chạy: node apps/api/scripts/prune-hydrosheds-versions.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const OBSOLETE_SOURCES = [
  'HydroRIVERS v10',
  'HydroRIVERS v10 vn-clip',
  'HydroLAKES v10',
  'HydroLAKES v10 vn-clip',
  'thuyhe.geojson',
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL chưa được đặt');

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  const { rows } = await client.query(
    `SELECT id, layer_key, source, feature_count, is_active
     FROM app.dataset_versions WHERE source = ANY($1) ORDER BY layer_key`,
    [OBSOLETE_SOURCES]
  );

  if (rows.length === 0) {
    console.log('Không còn version cũ nào — không có gì để xóa.');
  } else {
    const active = rows.filter((r) => r.is_active);
    if (active.length) {
      console.error('TỪ CHỐI XÓA: các version sau đang active —');
      for (const r of active) console.error(`  ${r.layer_key} "${r.source}"`);
      console.error('Hãy chạy seed + ingest:rivers để OSM thành active trước.');
      process.exitCode = 1;
    } else {
      await client.query('BEGIN');
      for (const r of rows) {
        // Xóa feature trước, rồi tới version (khoá ngoại).
        await client.query(`DELETE FROM water.${r.layer_key} WHERE dataset_version_id = $1`, [r.id]);
        await client.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [r.id]);
        console.log(`đã xóa ${r.layer_key} "${r.source}" (${r.feature_count} đối tượng)`);
      }
      await client.query('COMMIT');
      console.log(`\nXóa xong ${rows.length} version cũ.`);
    }
  }
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
```

- [ ] **Step 2: Chạy script**

Run: `node --env-file=apps/api/.env apps/api/scripts/prune-hydrosheds-versions.mjs`

Expected: liệt kê các version đã xóa. Nếu báo "TỪ CHỐI XÓA", nghĩa là Task 10 chưa kích hoạt OSM — quay lại chạy `ingest:rivers`.

- [ ] **Step 3: Kiểm chứng chỉ còn version OSM**

```bash
cd infra && docker compose exec -T db sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"SELECT layer_key, source, feature_count, is_active FROM app.dataset_versions WHERE layer_key IN ('rivers','lakes') ORDER BY layer_key;\"" && cd ..
```

Expected: chỉ còn dòng có source `OSM waterways` / `OSM water bodies`, `is_active = t`.

- [ ] **Step 4: Chạy test API**

Run: `npm run test -w @webatlas/api`
Expected: toàn bộ PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/prune-hydrosheds-versions.mjs
git commit -m "feat(api): script xóa version HydroSHEDS sau khi chuyển sang OSM"
```

---

## Task 12: Frontend — nhãn loại sông và attribution

**Files:**
- Modify: `apps/web/src/components/DynamicPopup.tsx:203-205`
- Modify: `apps/web/src/components/DynamicLegend.tsx:64`
- Test: `apps/web/src/features/map/model/styles.test.ts` (bổ sung)

**Interfaces:**
- Consumes: `STREAM_ORDER_LABELS` (Task 7)
- Produces: popup hiện nhãn loại thay vì "Cấp N"; chú giải có ghi công ODbL

**Vì sao cần:** `stream_order` giờ là hạng theo loại, không còn là bậc Strahler. Hiển thị "Cấp 5" là nói sai về dữ liệu.

- [ ] **Step 1: Viết test thất bại cho độ rộng nét theo hạng mới**

Thêm vào cuối `apps/web/src/features/map/model/styles.test.ts`:

```ts
import { STREAM_ORDER_LABELS } from '@webatlas/shared';

describe('độ rộng nét sông theo hạng OSM', () => {
  const widthOf = (order: number): number => {
    const styles = riversStyle({ get: (k: string) => (k === 'streamOrder' ? order : undefined) } as any);
    const stroke = (Array.isArray(styles) ? styles[1] : styles).getStroke();
    return stroke?.getWidth() ?? 0;
  };

  it('sông chính vẽ đậm hơn kênh, kênh đậm hơn suối, suối đậm hơn mương', () => {
    expect(widthOf(5)).toBeGreaterThan(widthOf(4));
    expect(widthOf(4)).toBeGreaterThan(widthOf(2));
    expect(widthOf(2)).toBeGreaterThanOrEqual(widthOf(1));
  });

  it('mọi hạng OSM đều có nhãn hiển thị', () => {
    for (const order of [5, 4, 2, 1]) {
      expect(STREAM_ORDER_LABELS[order]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận trạng thái hiện tại**

Run: `npx vitest run src/features/map/model/styles.test.ts --root apps/web`
Expected: PASS. `RIVER_WIDTHS` hiện tại đã cho hạng 5 → bucket 2, hạng 4 → bucket 2 — nếu test FAIL ở phép so sánh 5 > 4, sang Step 3 để tách bucket; nếu PASS, ghi nhận và vẫn làm Step 3 để nhãn chính xác.

- [ ] **Step 3: Tách bucket cho hạng 5 và 4**

Trong `apps/web/src/features/map/model/styles.ts`, thay hàm `riverBucket` (dòng 14-19):

```ts
function riverBucket(order: number): 0 | 1 | 2 | 3 {
  if (order >= 6) return 3;
  if (order >= 4) return 2;
  if (order === 3) return 1;
  return 0;
}
```

bằng:

```ts
// Hạng theo loại OSM (xem packages/shared/src/osm-water.ts):
// 5 = sông chính, 4 = kênh đào, 2 = suối, 1 = mương.
function riverBucket(order: number): 0 | 1 | 2 | 3 {
  if (order >= 5) return 3;
  if (order === 4) return 2;
  if (order === 3 || order === 2) return 1;
  return 0;
}
```

- [ ] **Step 4: Sửa popup sang nhãn loại**

Trong `apps/web/src/components/DynamicPopup.tsx`, thay dòng 203-205:

```tsx
          {props.streamOrder != null && (
            <div className="info-row"><Info size={14} className="text-blue-500" />
              <span>Cấp sông: <strong>Cấp {props.streamOrder}</strong></span></div>)}
```

bằng:

```tsx
          {/* stream_order giờ là hạng theo LOẠI dòng chảy (OSM), không phải bậc
              Strahler — nên hiển thị nhãn loại thay vì "Cấp N". */}
          {props.streamOrder != null && STREAM_ORDER_LABELS[props.streamOrder] && (
            <div className="info-row"><Info size={14} className="text-blue-500" />
              <span>Loại: <strong>{STREAM_ORDER_LABELS[props.streamOrder]}</strong></span></div>)}
```

Thêm import ở đầu file, cạnh các import `@webatlas/shared` sẵn có:

```tsx
import { STREAM_ORDER_LABELS } from '@webatlas/shared';
```

- [ ] **Step 5: Thêm ghi công ODbL vào chú giải**

Trong `apps/web/src/components/DynamicLegend.tsx`, tìm khối `if (layer.id === 'layer_rivers') {` ở dòng 64 và thêm dòng ghi công vào phần render của khối đó. Đọc đoạn xung quanh trước, rồi thêm ngay sau các mục chú giải sông:

```tsx
          <div className="legend-attribution">Sông, hồ: © OpenStreetMap contributors (ODbL)</div>
```

Thêm style vào `apps/web/src/styles/main.css`:

```css
.legend-attribution {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 6px;
  line-height: 1.3;
}
```

- [ ] **Step 6: Chạy test và build**

Run: `npm run test -w @webatlas/web && npm run build -w @webatlas/web`
Expected: toàn bộ PASS, build thành công.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/model/styles.ts apps/web/src/features/map/model/styles.test.ts apps/web/src/components/DynamicPopup.tsx apps/web/src/components/DynamicLegend.tsx apps/web/src/styles/main.css
git commit -m "feat(web): nhãn loại dòng chảy OSM + ghi công ODbL"
```

---

## Task 13: Báo cáo đối chiếu đập

**Files:**
- Create: `apps/api/scripts/report-dam-crosscheck.mjs`
- Create: `docs/reports/dam-crosscheck.md` (generated, commit)

**Interfaces:**
- Consumes: cache OSM thô (Task 6); `apps/web/public/thuydienvietnam.geojson`
- Produces: báo cáo Markdown. **Không ghi DB, không đổi dữ liệu đập.**

**Vì sao chỉ báo cáo:** danh mục 371 đập có các trường ISO thật (công suất, sản lượng, năm vận hành) mà OSM không có. Trộn vào sẽ làm hỏng dữ liệu đang tốt. Người dùng rà tay và tự quyết.

- [ ] **Step 1: Viết script**

Tạo `apps/api/scripts/report-dam-crosscheck.mjs`:

```js
/**
 * Đối chiếu đập OSM (waterway=dam) với danh mục 371 đập của dự án.
 *
 * CHỈ SINH BÁO CÁO — không sửa dữ liệu. Danh mục có các trường ISO (công suất,
 * sản lượng, năm vận hành) mà OSM không có, nên không trộn tự động.
 *
 * Hai việc báo cáo giúp được:
 *   1. Đập OSM có tên nhưng không khớp danh mục -> có thể danh mục còn thiếu.
 *   2. 19 đập trong danh mục thiếu toạ độ -> gợi ý ứng viên OSM cùng tên.
 *
 * Chạy: node apps/api/scripts/report-dam-crosscheck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const cacheDir = path.join(scriptDir, '.osm-cache');
const outPath = path.join(repoRoot, 'docs/reports/dam-crosscheck.md');

/** Chuẩn hoá tên tiếng Việt để so khớp: bỏ dấu, bỏ ký tự đặc biệt, thường hoá. */
function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\b(thuy dien|ho chua|dap|nha may)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Đọc danh mục đập ĐẦY ĐỦ (trước khi cắt theo vùng).
 *
 * clip-to-region.mjs ghi đè file này tại chỗ, nên đọc thẳng từ working tree sẽ
 * đếm thiếu số đập ngoài vùng. Ưu tiên lấy bản gốc từ git; nếu không có
 * (repo chưa commit) thì mới dùng file trên đĩa.
 */
function readFullCatalogue() {
  const relPath = 'apps/web/public/thuydienvietnam.geojson';
  try {
    const fromGit = execFileSync('git', ['show', `HEAD:${relPath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(fromGit);
  } catch {
    console.warn('! Không lấy được bản gốc từ git — dùng file trên đĩa (có thể đã bị cắt).');
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
  }
}

const catalogue = readFullCatalogue();
const rawPath = path.join(cacheDir, 'osm-waterways-raw.geojson');
if (!fs.existsSync(rawPath)) {
  throw new Error(`Thiếu ${rawPath}. Chạy fetch-osm-waterways.mjs trước.`);
}
const osm = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

const osmDams = osm.features.filter((f) => f.properties?.waterway === 'dam');
const osmNamed = osmDams.filter((f) => f.properties.name);

const catByName = new Map();
for (const f of catalogue.features) {
  const key = normalizeName(f.properties.Vietnamese);
  if (key) catByName.set(key, f);
}

// 1. Đập OSM có tên nhưng không có trong danh mục.
const unmatched = osmNamed.filter((f) => !catByName.has(normalizeName(f.properties.name)));

// 2. Đập trong danh mục thiếu toạ độ + ứng viên OSM cùng tên.
const missingGeom = catalogue.features.filter((f) => !f.geometry);
const suggestions = missingGeom.map((f) => {
  const key = normalizeName(f.properties.Vietnamese);
  const match = osmNamed.find((o) => normalizeName(o.properties.name) === key);
  return { name: f.properties.Vietnamese, id: f.properties.ID, match };
});

const lines = [
  '# Báo cáo đối chiếu đập: OSM vs danh mục dự án',
  '',
  `*Sinh tự động bởi \`apps/api/scripts/report-dam-crosscheck.mjs\` — ${new Date().toISOString().slice(0, 10)}*`,
  '',
  '**Báo cáo này không sửa dữ liệu.** Danh mục dự án có các trường ISO (công suất,',
  'sản lượng, năm vận hành) mà OSM không có, nên mọi thay đổi phải do người rà soát quyết định.',
  '',
  '## Tổng quan',
  '',
  `- Danh mục dự án: **${catalogue.features.length}** đập (trong đó **${missingGeom.length}** thiếu toạ độ)`,
  `- OSM \`waterway=dam\` trong vùng: **${osmDams.length}** (trong đó **${osmNamed.length}** có tên)`,
  `- Đập OSM có tên nhưng không khớp danh mục: **${unmatched.length}**`,
  '',
  '## 1. Đập OSM không khớp danh mục',
  '',
  'Có thể là đập nhỏ/thuỷ lợi (không thuộc phạm vi danh mục thuỷ điện), hoặc là thiếu sót của danh mục.',
  '',
];

if (unmatched.length === 0) {
  lines.push('*Không có.*', '');
} else {
  lines.push('| Tên OSM | osmId |', '|---|---|');
  for (const f of unmatched) {
    lines.push(`| ${f.properties.name} | \`${f.properties.osmId}\` |`);
  }
  lines.push('');
}

lines.push(
  '## 2. Đập thiếu toạ độ trong danh mục',
  '',
  'Các đập này nằm trong DB với `geom = NULL` và không hiện trên bản đồ.',
  'Cột cuối là ứng viên OSM khớp tên — **cần kiểm tra thủ công trước khi dùng**.',
  ''
);

if (missingGeom.length === 0) {
  lines.push('*Không có.*', '');
} else {
  lines.push('| ID | Tên | Ứng viên OSM |', '|---|---|---|');
  for (const s of suggestions) {
    const hint = s.match ? `\`${s.match.properties.osmId}\` (${s.match.properties.name})` : '—';
    lines.push(`| ${s.id} | ${s.name} | ${hint} |`);
  }
  lines.push('');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`Đã ghi ${outPath}`);
console.log(`  ${unmatched.length} đập OSM không khớp; ${missingGeom.length} đập thiếu toạ độ`);
```

- [ ] **Step 2: Chạy script**

Run: `node apps/api/scripts/report-dam-crosscheck.mjs`
Expected: in ra đường dẫn báo cáo và hai con số.

- [ ] **Step 3: Đọc báo cáo**

Run: `cat docs/reports/dam-crosscheck.md`
Expected: báo cáo có phần tổng quan và hai bảng. Kiểm tra bảng đọc được và số liệu hợp lý (danh mục 371 đập, 19 thiếu toạ độ).

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/report-dam-crosscheck.mjs docs/reports/dam-crosscheck.md
git commit -m "feat(api): báo cáo đối chiếu đập OSM với danh mục dự án"
```

---

## Task 14: Kiểm chứng đầu-cuối

**Files:**
- Modify: `README.md` (mục project status)

**Interfaces:**
- Consumes: mọi task trước
- Produces: xác nhận toàn hệ thống hoạt động

**Vì sao là task riêng:** các task trước kiểm tra từng phần. Task này kiểm tra tổng thể — gồm cả nhìn bằng mắt trên app thật, thứ mà test không thay được.

- [ ] **Step 1: Chạy toàn bộ test**

Run: `npm run test -w @webatlas/api && npm run test -w @webatlas/web && npm run build -w @webatlas/web`
Expected: toàn bộ PASS, build thành công. Ghi lại số lượng test.

- [ ] **Step 2: Kiểm chứng không còn đối tượng ngoài vùng trong DB**

```bash
cd infra && docker compose exec -T db sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"
SELECT 'rivers' AS layer, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE ST_X(ST_Centroid(geom)) < 107.0 OR ST_X(ST_Centroid(geom)) > 110.0) AS ngoai_kinh_do
FROM water.rivers r JOIN app.dataset_versions v ON r.dataset_version_id = v.id WHERE v.is_active
UNION ALL
SELECT 'lakes', COUNT(*),
       COUNT(*) FILTER (WHERE ST_X(ST_Centroid(geom)) < 107.0 OR ST_X(ST_Centroid(geom)) > 110.0)
FROM water.lakes l JOIN app.dataset_versions v ON l.dataset_version_id = v.id WHERE v.is_active;\"" && cd ..
```

Expected: `total` > 0 cho cả hai; `ngoai_kinh_do` bằng 0 hoặc rất nhỏ (vùng nằm trong 107–110°E; số nhỏ khác 0 là đối tượng vắt ngang biên, đúng theo thiết kế).

- [ ] **Step 3: Kiểm chứng WFS phục vụ đủ 8 layer**

```bash
for L in dams rivers lakes stations flood_zones drought_points saltwater_intrusion flood_generation; do
  echo -n "$L: "
  curl -s "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:$L&resultType=hits" | grep -oE 'numberMatched="[0-9]+"' || echo "THẤT BẠI"
done
```

Expected: cả 8 layer trả về số, không layer nào THẤT BẠI.

- [ ] **Step 4: Kiểm chứng sông/hồ có tên**

```bash
curl -s "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:rivers&outputFormat=application/json&count=200" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
const fc=JSON.parse(s);
const named=fc.features.filter(f=>f.properties.name).length;
console.log('200 sông đầu:',named,'có tên');
console.log('ví dụ:',fc.features.filter(f=>f.properties.name).slice(0,5).map(f=>f.properties.name).join(', '));
});"
```

Expected: số có tên > 0 và in ra được tên sông thật. Đây là kiểm chứng trực tiếp cho giá trị lớn nhất của thay đổi này.

- [ ] **Step 5: Chạy app và xem bằng mắt**

Khởi động app và kiểm tra trực quan:

```bash
npm run dev:web
```

Mở trình duyệt và xác nhận từng điểm:
1. Ranh giới tỉnh hiển thị **cả nước**, tên là tên tỉnh mới (34 tỉnh)
2. Zoom vào vùng → thấy ranh giới xã; zoom ra Hà Nội → chỉ có ranh giới tỉnh (đúng thiết kế)
3. Sông bám lòng sông thật trên nền bản đồ, **không còn hình bậc thang**
4. Bấm vào một con sông → popup hiện **tên** và nhãn loại ("Sông chính"/"Suối"/...)
5. Bấm vào một hồ → popup hiện tên và loại
6. Không có sông/hồ nào nằm ngoài 6 tỉnh
7. Console trình duyệt không có lỗi

- [ ] **Step 6: Cập nhật project status trong README**

Thêm vào cuối danh sách `## Project status` trong `README.md`:

```markdown
- [x] **Vùng công tác + OSM waterways + ranh giới 34 tỉnh** (dữ liệu chuyên đề giới hạn trong 6 tỉnh Nam Trung Bộ & Tây Nguyên; sông/hồ từ OpenStreetMap có tên riêng; ranh giới hành chính sau sáp nhập 01/7/2025).
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: cập nhật project status sau khi chuyển sang vùng công tác + OSM"
```

---

## Ghi chú vận hành

**Thứ tự chạy lại pipeline dữ liệu từ đầu:**

```bash
node apps/api/scripts/fetch-boundaries.mjs        # ranh giới hành chính
node apps/api/scripts/fetch-osm-waterways.mjs     # tải OSM thô
node apps/api/scripts/explore-osm.mjs             # kiểm tra tag đã đổi chưa
node apps/api/scripts/build-osm-seeds.mjs         # dựng file seed
node apps/api/scripts/report-dam-crosscheck.mjs   # báo cáo đập (TRƯỚC khi cắt)
node apps/api/scripts/clip-to-region.mjs          # cắt xuống vùng
npm run seed -w @webatlas/api                     # nạp DB
npm run ingest:rivers -w @webatlas/api            # BẮT BUỘC sau seed
```

**Ba bẫy về thứ tự:**

1. `npm run seed` nạp thuyhe làm rivers v1 rồi kích hoạt, **ghi đè bản OSM**. Luôn chạy `ingest:rivers` NGAY SAU `seed`.
2. `clip-to-region.mjs` **ghi đè `thuydienvietnam.geojson` tại chỗ**. Chạy `report-dam-crosscheck.mjs` trước để đếm đúng danh mục đầy đủ (script có dự phòng đọc từ `git show HEAD:` nếu chạy sau).
3. `clip-to-region.mjs` chạy nhiều lần là an toàn (idempotent — lần hai không bỏ thêm gì), nhưng file seed đã cắt thì `git restore` mới về được bản đầy đủ.

**Đổi vùng công tác:** sửa `REGION_PROVINCE_CODES` trong `packages/shared/src/region.ts`, đồng thời sửa hằng `REGION_CODES` lặp lại trong `fetch-boundaries.mjs`, `fetch-osm-waterways.mjs` và `clip-to-region.mjs` (script `.mjs` không import được TS), rồi chạy lại pipeline.
