import { GEOSERVER_URL } from '../../../shared/config';

/**
 * Tra cứu thuộc tính cho các lớp NỀN (đường, đường sắt, mặt nước, địa danh).
 *
 * Các lớp này đến trình duyệt dưới dạng ẢNH TILE đã dựng sẵn từ GWC, nên chúng
 * không phải đối tượng vector — nhấp vào chỉ trúng điểm ảnh, và
 * map.forEachFeatureAtPixel() không bao giờ thấy gì. Muốn biết con đường vừa nhấp
 * tên gì thì phải hỏi ngược GeoServer bằng GetFeatureInfo.
 *
 * Đây là một yêu cầu RIÊNG, không đụng gì tới tile, nên không làm bản đồ dựng
 * chậm thêm; chỉ chạy khi người dùng thật sự nhấp vào chỗ trống.
 */

/** Các lớp được hỏi, theo thứ tự ưu tiên khi một cú nhấp trúng nhiều lớp. */
export const BASEMAP_INFO_LAYERS = [
  'webatlas:roads_region',
  'webatlas:roads_vn',
  'webatlas:railways_vn',
  'webatlas:water_region',
] as const;

/** Bán kính chấp nhận sai, tính bằng điểm ảnh. Nét đường chỉ rộng 1–3 px nên
 *  đòi nhấp trúng chính xác là bất khả thi với chuột, càng không với cảm ứng. */
const CLICK_BUFFER_PX = 8;

/** Số đối tượng tối đa GeoServer trả về cho một cú nhấp — đủ để chọn cái có tên
 *  ở ngã ba, không nhiều tới mức phải tải về vô ích. */
const MAX_FEATURES = 8;

export interface BasemapFeature {
  name: string | null;
  fclass?: string;
  ref?: string;
  oneway?: string;
  maxspeed?: number;
  bridge?: string;
  tunnel?: string;
}

/** Các thuộc tính đáng hiện cho người đọc. osm_id và code là định danh nội bộ. */
const SHOWN_KEYS = ['name', 'fclass', 'ref', 'oneway', 'maxspeed', 'bridge', 'tunnel'] as const;

export function basemapInfoUrl(
  extent: [number, number, number, number],
  size: [number, number],
  pixel: [number, number],
): string {
  const layers = BASEMAP_INFO_LAYERS.join(',');
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: layers,
    QUERY_LAYERS: layers,
    // WMS 1.3.0 dùng I/J cho toạ độ điểm ảnh (1.1.1 dùng X/Y).
    I: String(Math.round(pixel[0])),
    J: String(Math.round(pixel[1])),
    WIDTH: String(Math.round(size[0])),
    HEIGHT: String(Math.round(size[1])),
    // BBOX phải khớp đúng khung nhìn đã gửi WIDTH/HEIGHT, nếu không điểm ảnh
    // được quy chiếu sai chỗ và kết quả trả về là con đường bên cạnh.
    BBOX: extent.map((n) => String(Math.round(n))).join(','),
    CRS: 'EPSG:3857',
    INFO_FORMAT: 'application/json',
    FEATURE_COUNT: String(MAX_FEATURES),
    BUFFER: String(CLICK_BUFFER_PX),
  });
  return `${GEOSERVER_URL}/webatlas/wms?${params.toString()}`;
}

interface RawCollection {
  features?: Array<{ properties?: Record<string, unknown> }>;
}

export function pickBasemapFeature(data: RawCollection): BasemapFeature | null {
  const features = data.features ?? [];
  if (features.length === 0) return null;

  // Một cú nhấp ở ngã ba trả về nhiều tuyến. Cái CÓ TÊN là cái người dùng nhận
  // ra và hỏi về; tuyến không tên chỉ là đoạn nối.
  const named = features.find((f) => {
    const n = f.properties?.name;
    return typeof n === 'string' && n.trim().length > 0;
  });
  const chosen = named ?? features[0];
  const props = chosen.properties ?? {};

  const out: Record<string, unknown> = { name: null };
  for (const key of SHOWN_KEYS) {
    const value = props[key];
    if (value === undefined || value === null || value === '') continue;
    // OSM ghi 0 cho "không có số liệu" chứ không phải giới hạn 0 km/h.
    if (key === 'maxspeed' && value === 0) continue;
    out[key] = value;
  }
  if (!('name' in out) || out.name === undefined) out.name = null;
  return out as unknown as BasemapFeature;
}

export async function fetchBasemapInfo(
  extent: [number, number, number, number],
  size: [number, number],
  pixel: [number, number],
  signal?: AbortSignal,
): Promise<BasemapFeature | null> {
  const res = await fetch(basemapInfoUrl(extent, size, pixel), { signal });
  if (!res.ok) return null;
  return pickBasemapFeature((await res.json()) as RawCollection);
}
