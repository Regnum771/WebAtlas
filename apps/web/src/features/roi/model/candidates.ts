import { EDITABLE_LAYER_KEYS, isRegionProvince, type EditableLayerKey, type ReferenceLayerKey, type Roi } from '@webatlas/shared';
import type { SearchHit } from '../../search/api/search.api';
import type { MemberEntity } from '../api/roi.api';

/** One "Dùng làm vùng phân tích" row (U-6). `roi: null` rows only carry a note. */
export interface RoiCandidate {
  key: string;
  label: string;
  detail: string;
  roi: Roi | null;
  note?: string;
}

const NOUN: Record<EditableLayerKey, string> = {
  dams: 'đập', rivers: 'đoạn sông', lakes: 'hồ', stations: 'trạm quan trắc', flood_zones: 'vùng ngập lụt',
  drought_points: 'điểm hạn hán', saltwater_intrusion: 'điểm xâm nhập mặn', flood_generation: 'vùng sinh lũ',
};

interface ThematicProps { layerKey?: string; id?: string; geographicalName?: string | null; name?: string | null }

/** The clicked thematic feature. A named river way is offered as its whole river (FR-13). */
export function thematicCandidate(props: ThematicProps): RoiCandidate | null {
  if (!props.id || !(EDITABLE_LAYER_KEYS as readonly string[]).includes(props.layerKey ?? '')) return null;
  const layerKey = props.layerKey as EditableLayerKey;
  const name = props.geographicalName ?? props.name ?? null;
  if (layerKey === 'rivers' && name) {
    return {
      key: `feature:${props.id}`, label: name, detail: 'cả sông',
      roi: { source: 'feature', layerKey, featureId: props.id, whole: true },
    };
  }
  return {
    key: `feature:${props.id}`,
    label: name ?? (layerKey === 'rivers' ? 'Đoạn sông không tên' : 'Đối tượng không tên'),
    detail: NOUN[layerKey],
    roi: { source: 'feature', layerKey, featureId: props.id },
  };
}

const TABLE_TO_LAYER: Record<string, ReferenceLayerKey> = {
  roads_region: 'roads', railways_vn: 'railways', water_region: 'water',
};
/** roads_vn is the national duplicate the entity builder skips, so it has no entities. */
export function referenceLayerOfTable(table: string): ReferenceLayerKey | null {
  return TABLE_TO_LAYER[table] ?? null;
}

const ENTITY_NOUN: Partial<Record<ReferenceLayerKey, string>> = {
  roads: 'cả tuyến đường', railways: 'cả tuyến đường sắt', water: 'mặt nước',
};
export function entityCandidates(layer: ReferenceLayerKey, entities: MemberEntity[]): RoiCandidate[] {
  return entities.map((e) => ({
    key: `reference:${e.entityId}`,
    label: e.name ?? e.ref ?? 'Thực thể không tên',
    detail: ENTITY_NOUN[layer] ?? 'thực thể',
    roi: { source: 'reference', referenceLayer: layer, entityId: e.entityId },
  }));
}

interface AdminProps { code: string; name: string; fullName?: string | null }

/** The ward (from zoom 10, where its layer loads) and the province under the click. */
export function adminCandidates(province: AdminProps | null, ward: AdminProps | null, zoom: number): RoiCandidate[] {
  const out: RoiCandidate[] = [];
  if (ward) {
    out.push({
      key: `ward:${ward.code}`, label: ward.fullName ?? ward.name, detail: 'xã/phường',
      roi: { source: 'admin', level: 'ward', code: ward.code },
    });
  } else if (province && zoom < 10) {
    out.push({ key: 'ward:zoom', label: 'Xã/phường', detail: '', roi: null, note: 'phóng to tới mức 10 để chọn xã' });
  }
  if (province) {
    const label = province.fullName ?? province.name;
    out.push(isRegionProvince(province.code)
      ? { key: `province:${province.code}`, label, detail: 'tỉnh', roi: { source: 'admin', level: 'province', code: province.code } }
      : { key: `province:${province.code}`, label, detail: 'tỉnh', roi: null, note: 'ngoài vùng công tác' });
  }
  return out;
}

/** A search hit as an ROI. A river hit is already the level-1 river (search filters by level). */
export function roiOfSearchHit(hit: SearchHit): Roi {
  switch (hit.source) {
    case 'layer': return { source: 'feature', layerKey: hit.layerKey, featureId: hit.featureId };
    case 'reference': return { source: 'reference', referenceLayer: hit.layerKey as ReferenceLayerKey, entityId: hit.featureId };
    case 'admin': return { source: 'admin', level: hit.layerKey, code: hit.featureId };
  }
}
