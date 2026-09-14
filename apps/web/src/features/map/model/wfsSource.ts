import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import type Feature from 'ol/Feature';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import { LAYER_ATTRIBUTE_MAP, normalizeFeatureProperties, toDamStatusSlug, DAM_STATUS_DISPLAY, type EditableLayerKey } from '@webatlas/shared';
import { GEOSERVER_URL } from '../../../shared/config';

/**
 * URL WFS GetFeature. Có `extent` (EPSG:3857, do OpenLayers cấp) thì giới hạn theo bbox.
 * `srsName` vẫn là EPSG:4326 vì đó là hệ toạ độ GeoServer trả về; chỉ bbox dùng 3857
 * để khớp với hệ chiếu khung nhìn.
 */
export function wfsUrl(typeName: string, extent?: number[]): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
  });
  if (extent) {
    params.set('bbox', `${extent.join(',')},EPSG:3857`);
  }
  return `${GEOSERVER_URL}/ows?${params.toString()}`;
}

/**
 * Chuẩn hoá feature vừa tải: bỏ feature không hình học, đổi tên thuộc tính DB -> ISO,
 * đóng dấu `layerKey`, và với lớp đập thì tính sẵn `statusSlug` + nhãn hiển thị.
 *
 * PHẢI idempotent: dưới chiến lược bbox, `featuresloadend` bắn theo từng extent nên
 * một feature có thể được xử lý nhiều lần. Dấu `layerKey` đóng vai trò cờ "đã xử lý".
 */
export function normalizeLoadedFeatures(layerKey: EditableLayerKey, features: Feature[]): void {
  for (const f of features) {
    if (!f.getGeometry()) continue;
    // Đã chuẩn hoá rồi thì bỏ qua — tránh churn thuộc tính mỗi lần pan.
    if (f.get('layerKey') === layerKey) continue;

    const raw = f.getProperties();
    const geomKey = f.getGeometryName();
    const dbProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k !== geomKey) dbProps[k] = v;
    }
    const iso = normalizeFeatureProperties(layerKey, dbProps);
    for (const k of Object.keys(dbProps)) f.unset(k, true);
    f.setProperties(iso, true);

    if (layerKey === 'dams') {
      const slug = toDamStatusSlug(f.get('operationalStatus'));
      f.set('statusSlug', slug, true);
      f.set('operationalStatus', DAM_STATUS_DISPLAY[slug].label, true);
    }
  }
}

/**
 * VectorSource for a thematic layer served from GeoServer WFS as GeoJSON.
 * - Reprojects EPSG:4326 -> EPSG:3857 (map view projection).
 * - Drops features with no geometry (e.g. coordinate-less dams).
 * - Renames properties to ISO/INSPIRE names and stamps `layerKey`.
 */
export function createWfsVectorSource(layerKey: EditableLayerKey): VectorSource {
  const info = LAYER_ATTRIBUTE_MAP[layerKey];
  const format = new GeoJSON();
  const source = new VectorSource({
    format,
    strategy: bboxStrategy,
    url: (extent) => wfsUrl(info.wfsTypeName, extent),
  });

  // Dưới bbox, số request tăng nhiều nên lỗi tạm thời dễ xảy ra hơn và để lại
  // "lỗ hổng" trên bản đồ. Ghi log để chẩn đoán. Không tự thử lại (ngoài phạm vi spec).
  // Lưu ý: sự kiện featuresloaderror của OpenLayers KHÔNG kèm extent.
  source.on('featuresloaderror', () => {
    console.error(`[wfs] tải feature thất bại cho lớp "${layerKey}"`);
  });

  source.on('featuresloadend', (evt) => {
    const loaded = (evt as unknown as { features?: Feature[] }).features ?? [];
    normalizeLoadedFeatures(layerKey, loaded);
    // Feature không hình học không dùng được để vẽ — loại khỏi source.
    for (const f of loaded) {
      if (!f.getGeometry()) source.removeFeature(f);
    }
    source.changed();
  });

  return source;
}
