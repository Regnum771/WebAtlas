import { describe, it, expect } from 'vitest';
import { adminCandidates, entityCandidates, referenceLayerOfTable, roiOfSearchHit, thematicCandidate } from './candidates';

describe('thematicCandidate', () => {
  it('offers a named river way as the whole river (FR-13)', () => {
    expect(thematicCandidate({ layerKey: 'rivers', id: 'w1', geographicalName: 'Sông Thu Bồn' })).toEqual({
      key: 'feature:w1', label: 'Sông Thu Bồn', detail: 'cả sông',
      roi: { source: 'feature', layerKey: 'rivers', featureId: 'w1', whole: true },
    });
  });
  it('offers an unnamed way as itself', () => {
    expect(thematicCandidate({ layerKey: 'rivers', id: 'w2' })).toMatchObject({
      label: 'Đoạn sông không tên', detail: 'đoạn sông', roi: { source: 'feature', layerKey: 'rivers', featureId: 'w2' },
    });
  });
  it('offers a dam as a dam, and nothing without an id', () => {
    expect(thematicCandidate({ layerKey: 'dams', id: 'd1', geographicalName: 'Buôn Kuốp' }))
      .toMatchObject({ label: 'Buôn Kuốp', detail: 'đập', roi: { source: 'feature', layerKey: 'dams', featureId: 'd1' } });
    expect(thematicCandidate({ layerKey: 'dams' })).toBeNull();
  });
});

describe('adminCandidates', () => {
  const province = { code: '66', name: 'Đắk Lắk', fullName: 'Tỉnh Đắk Lắk' };
  const ward = { code: '22015', name: 'Tuy Hoà', fullName: 'Phường Tuy Hoà' };
  it('lists the ward then the province', () => {
    expect(adminCandidates(province, ward, 11)).toEqual([
      { key: 'ward:22015', label: 'Phường Tuy Hoà', detail: 'xã/phường', roi: { source: 'admin', level: 'ward', code: '22015' } },
      { key: 'province:66', label: 'Tỉnh Đắk Lắk', detail: 'tỉnh', roi: { source: 'admin', level: 'province', code: '66' } },
    ]);
  });
  it('below zoom 10, says how to reach the ward', () => {
    expect(adminCandidates(province, null, 8)[0]).toEqual({
      key: 'ward:zoom', label: 'Xã/phường', detail: '', roi: null, note: 'phóng to tới mức 10 để chọn xã',
    });
  });
  it('shows a province outside the region without an action', () => {
    expect(adminCandidates({ code: '01', name: 'Hà Nội', fullName: 'Thành phố Hà Nội' }, null, 11)).toEqual([
      { key: 'province:01', label: 'Thành phố Hà Nội', detail: 'tỉnh', roi: null, note: 'ngoài vùng công tác' },
    ]);
  });
});

describe('entityCandidates and referenceLayerOfTable', () => {
  it('maps the clicked table to its reference layer', () => {
    expect(referenceLayerOfTable('roads_region')).toBe('roads');
    expect(referenceLayerOfTable('railways_vn')).toBe('railways');
    expect(referenceLayerOfTable('water_region')).toBe('water');
    expect(referenceLayerOfTable('roads_vn')).toBeNull();
  });
  it('offers each whole entity the segment belongs to', () => {
    expect(entityCandidates('roads', [
      { entityId: 'roads:a:0', name: 'Quốc lộ 14', ref: 'QL.14' },
      { entityId: 'roads:b:0', name: null, ref: 'HCM' },
    ])).toEqual([
      { key: 'reference:roads:a:0', label: 'Quốc lộ 14', detail: 'cả tuyến đường', roi: { source: 'reference', referenceLayer: 'roads', entityId: 'roads:a:0' } },
      { key: 'reference:roads:b:0', label: 'HCM', detail: 'cả tuyến đường', roi: { source: 'reference', referenceLayer: 'roads', entityId: 'roads:b:0' } },
    ]);
  });
});

describe('roiOfSearchHit', () => {
  it('turns each kind of search hit into its ROI', () => {
    expect(roiOfSearchHit({ source: 'layer', layerKey: 'rivers', featureId: 'r1', name: 'Sông Ba', lonLat: [108, 13] }))
      .toEqual({ source: 'feature', layerKey: 'rivers', featureId: 'r1' });
    expect(roiOfSearchHit({ source: 'reference', layerKey: 'roads', featureId: 'roads:a:0', name: 'QL.14', lonLat: [108, 13] }))
      .toEqual({ source: 'reference', referenceLayer: 'roads', entityId: 'roads:a:0' });
    expect(roiOfSearchHit({ source: 'admin', layerKey: 'ward', featureId: '22015', name: 'Phường Tuy Hoà', lonLat: [109, 13] }))
      .toEqual({ source: 'admin', level: 'ward', code: '22015' });
  });
});
