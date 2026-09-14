import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import { scaleAtResolution } from './zoomScale';
import type { ReservoirFilterType } from './MapModel';
import { DAM_STATUS_DISPLAY, toDamStatusSlug, type DamStatusSlug, LAYER_PALETTE } from '@webatlas/shared';

// LAYER_PALETTE (packages/shared) holds the raw '#rrggbb' identity colors so the
// legend and the map can't silently diverge; opacity variants are still built
// here, since OL Style/Fill objects and translucency are a map-only concern.
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Bucket (từ riverBucket, theo hạng OSM waterway) -> [độ rộng viền, độ rộng lõi]. Bucket càng cao càng rộng.
// Bucket 0 là mặc định mỏng cho "mương / còn lại".
const RIVER_WIDTHS: Record<number, [number, number]> = {
  3: [7, 3.5],   // sông chính
  2: [5, 2.2],   // kênh đào
  1: [3, 1.2],   // suối
  0: [1.5, 0.5], // mương / không xác định
};

// Hạng theo loại OSM (xem packages/shared/src/osm-water.ts):
// 5 = sông chính, 4 = kênh đào, 2 = suối, 1 = mương.
function riverBucket(order: number): 0 | 1 | 2 | 3 {
  if (order >= 5) return 3;
  if (order === 4) return 2;
  if (order === 3 || order === 2) return 1;
  return 0;
}

// Precompute the 4 style arrays once at module load.
const RIVER_STYLES: Record<number, Style[]> = Object.fromEntries(
  ([0, 1, 2, 3] as const).map((b) => {
    const [borderWidth, mainWidth] = RIVER_WIDTHS[b];
    return [
      b,
      [
        new Style({ stroke: new Stroke({ color: '#1e3a8a', width: borderWidth }) }),
        new Style({ stroke: new Stroke({ color: LAYER_PALETTE.layer_rivers.color, width: mainWidth }) }),
      ],
    ];
  })
);

/**
 * So sánh ">= ngưỡng" có dung sai, vì ba ngưỡng dưới đây (1.000.000, 500.000,
 * 250.000) đều NẰM ĐÚNG trên ba nấc của thanh trượt. Đi vòng qua
 * zoomForScale -> resolution -> scaleAtResolution, mẫu số 1.000.000 quay về
 * thành 999.999,9999..., nên phép so sánh chặt sẽ cho ra mức chi tiết khác nhau
 * ở đúng một nấc người dùng bấm tới được — hành vi phụ thuộc nhiễu dấu phẩy động.
 * Một phần nghìn đơn vị mẫu số thấp hơn nhiều so với mức có nghĩa, và cao hơn
 * nhiều so với sai số làm tròn (~1e-4 ở thang 1e6).
 */
function atLeast(scale: number, threshold: number): boolean {
  return scale >= threshold - 0.001;
}

/**
 * Bucket nhỏ nhất còn được vẽ ở một resolution. Bucket càng cao càng là sông lớn,
 * và các bucket hiển thị luôn là một dải liên tục từ trên xuống, nên một con số
 * đủ diễn đạt cả bảng ngưỡng — không phải cấp phát Set nào trong hàm style chạy
 * mỗi đối tượng mỗi khung hình.
 *
 * Mẫu số CÀNG LỚN nghĩa là CÀNG THU NHỎ.
 */
export function minRiverBucketAt(resolution: number): 0 | 1 | 2 | 3 {
  const scale = scaleAtResolution(resolution);
  if (atLeast(scale, 1_000_000)) return 3; // chỉ sông chính
  if (atLeast(scale, 500_000)) return 2; // + kênh đào
  if (atLeast(scale, 250_000)) return 1; // + suối
  return 0; // + mương, chưa xác định
}

// Style cho mạng lưới sông ngòi động dựa trên cấp độ sông (Cap) — cached, no per-frame allocation.
// Trả undefined cho các bucket dưới ngưỡng của mức thu phóng hiện tại: OpenLayers
// hiểu "không có style" là không vẽ đối tượng. Phải là undefined chứ không phải
// null — kiểu StyleFunction của ol khai báo trả về Style | Style[] | void, nên
// null làm hỏng type-check ở chỗ gán style cho lớp (MapModel.ts).
// Đây là LOD HIỂN THỊ — WFS vẫn tải đủ dữ liệu, chỉ phần dựng hình nhẹ đi.
export const riversStyle = (feature: any, resolution: number) => {
  const cap = feature.get('streamOrder') || 6;
  const bucket = riverBucket(cap);
  if (bucket < minRiverBucketAt(resolution)) return undefined;
  return RIVER_STYLES[bucket];
};

export const stationsStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: LAYER_PALETTE.layer_stations.color }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const floodStyle = new Style({
  fill: new Fill({ color: hexToRgba(LAYER_PALETTE.layer_flood.color, 0.25) }),
  stroke: new Stroke({ color: LAYER_PALETTE.layer_flood.color, width: 1.5 })
});

export const lakesStyle = new Style({
  fill: new Fill({ color: hexToRgba(LAYER_PALETTE.layer_lakes.color, 0.35) }),  // sky-400, translucent water
  stroke: new Stroke({ color: LAYER_PALETTE.layer_lakes.stroke, width: 1 }),      // sky-600 shoreline
});

export const droughtSurveyStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: LAYER_PALETTE.layer_drought_survey.color }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const saltwaterIntrusionStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: LAYER_PALETTE.layer_saltwater_intrusion.color }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const floodGenerationStyle = new Style({
  fill: new Fill({ color: hexToRgba(LAYER_PALETTE.layer_flood_generation.color, 0.2) }),
  stroke: new Stroke({ color: LAYER_PALETTE.layer_flood_generation.color, width: 1.5 })
});

// ARCHIVED: dải màu pastel tô nền tỉnh/xã đã được gỡ (nền bản đồ tự lưu trữ đã
// cung cấp ngữ cảnh, và màu trang trí tranh chấp với màu DỮ LIỆU của lớp hiểm hoạ).
// Muốn khôi phục: `git show b84bf50:apps/web/src/features/map/model/styles.ts`
// — chứa provinceColors[] và hàm hashCode() băm màu theo mã xã.


// Style cho các tỉnh thành (ranh giới sau sáp nhập 2025 — properties: code, name, ...)
export const provincesStyle = (feature: any) => {
  const name = feature.get('name') || '';

  const geom = feature.getGeometry();
  let labelGeometry = feature.get('_labelGeom');
  if (!labelGeometry && geom) {
    const geomType = geom.getType();
    if (geomType === 'MultiPolygon') {
      const polygons = geom.getPolygons();
      let maxArea = -1;
      let largestPolygon = polygons[0];
      polygons.forEach((poly: any) => {
        const area = poly.getArea();
        if (area > maxArea) { maxArea = area; largestPolygon = poly; }
      });
      if (largestPolygon) labelGeometry = largestPolygon.getInteriorPoint();
    } else if (geomType === 'Polygon') {
      labelGeometry = geom.getInteriorPoint();
    }
    if (labelGeometry) feature.set('_labelGeom', labelGeometry, true);
  }
  if (!labelGeometry) labelGeometry = geom;

  return [
    new Style({
      // Tô nền trong SUỐT: bỏ dải màu pastel trang trí (xem ghi chú ARCHIVED ở
      // trên). Vẫn phải có fill — OpenLayers cần nó để hit-test phần RUỘT đa giác;
      // bỏ hẳn thì tỉnh chỉ còn bấm được đúng trên đường viền.
      fill: new Fill({ color: 'rgba(0,0,0,0)' }),
      stroke: new Stroke({ color: LAYER_PALETTE.layer_provinces_2026.color, width: 2.5 }),
    }),
    new Style({
      geometry: labelGeometry,
      text: new Text({
        text: name,
        font: 'bold 12px Inter, system-ui, sans-serif',
        fill: new Fill({ color: '#312e81' }),
        stroke: new Stroke({ color: '#ffffff', width: 4 }),
        overflow: true,
        padding: [2, 4, 2, 4]
      })
    })
  ];
};


// Style cho Phường/Xã (ranh giới sau sáp nhập 2025, chỉ hiện nét đứt, nhạt)
export const wardsStyle = (feature: any) => {
  const name = feature.get('name') || '';

  return new Style({
    // Trong suốt — xem ghi chú ARCHIVED và lý do giữ lại fill ở provincesStyle.
    fill: new Fill({ color: 'rgba(0,0,0,0)' }),
    stroke: new Stroke({ color: hexToRgba(LAYER_PALETTE.layer_wards_2026.color, 0.4), width: 1, lineDash: [4, 4] }),
    text: new Text({
      text: name,
      font: 'normal 10.5px Inter, system-ui, sans-serif',
      fill: new Fill({ color: '#374151' }),
      stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
      overflow: false,
      padding: [1, 2, 1, 2]
    })
  });
};

// Cache CircleStyle by `${slug}|${radius}` — bounded (3 slugs x ~13 integer radii).
const damStyleCache = new Map<string, Style>();

function damStyle(slug: DamStatusSlug, radius: number): Style {
  const key = `${slug}|${radius}`;
  let style = damStyleCache.get(key);
  if (!style) {
    style = new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: DAM_STATUS_DISPLAY[slug].color }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
    });
    damStyleCache.set(key, style);
  }
  return style;
}

// Cartodiagram: size ~ ratedPower, color ~ operational status (real DB slug, stamped at load).
// Reads the pre-computed statusSlug (Task 4); does NOT mutate the feature or derive status from id.
export function makeDamsStyle(getReservoirFilter: () => ReservoirFilterType) {
  return (feature: any): Style | undefined => {
    const slug = toDamStatusSlug(feature.get('statusSlug'));

    const currentFilter = getReservoirFilter();
    if (currentFilter !== 'all' && currentFilter !== slug) return undefined;

    const wattage = feature.get('ratedPower') || 50;
    const radius = Math.round(Math.max(6, Math.min(18, 6 + wattage / 180)));
    return damStyle(slug, radius);
  };
}

// Highlight styles (cached) for ol/interaction/Select on rivers.
const RIVER_SELECT_STYLES: Record<number, Style[]> = Object.fromEntries(
  ([0, 1, 2, 3] as const).map((b) => {
    const [borderWidth, mainWidth] = RIVER_WIDTHS[b];
    return [
      b,
      [
        new Style({ stroke: new Stroke({ color: '#fde047', width: borderWidth + 4 }) }),
        new Style({ stroke: new Stroke({ color: '#ef4444', width: mainWidth + 2 }) }),
      ],
    ];
  })
);

// Style highlight khi click chọn một đoạn sông (dùng cho ol/interaction/Select)
export function makeRiverSelectStyle() {
  return (feature: any) => {
    const cap = feature.get('streamOrder') || 6;
    return RIVER_SELECT_STYLES[riverBucket(cap)];
  };
}
