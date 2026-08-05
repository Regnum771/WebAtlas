import { describe, it, expect, vi } from 'vitest';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { normalizeLoadedFeatures } from './wfsSource';

describe('normalizeLoadedFeatures', () => {
  it('đổi tên thuộc tính DB sang tên ISO và đóng dấu layerKey', () => {
    const f = new Feature({ geometry: new Point([0, 0]), name: 'Sông Ba', stream_order: 4 });
    normalizeLoadedFeatures('rivers', [f]);
    expect(f.get('layerKey')).toBe('rivers');
    expect(f.get('streamOrder')).toBe(4);
    expect(f.get('stream_order')).toBeUndefined();
  });

  it('chạy lại lần hai không làm đổi thuộc tính (idempotent)', () => {
    const f = new Feature({ geometry: new Point([0, 0]), name: 'Sông Ba', stream_order: 4 });
    normalizeLoadedFeatures('rivers', [f]);
    const after1 = { ...f.getProperties() };
    delete (after1 as Record<string, unknown>).geometry;

    normalizeLoadedFeatures('rivers', [f]);
    const after2 = { ...f.getProperties() };
    delete (after2 as Record<string, unknown>).geometry;

    expect(after2).toEqual(after1);
  });

  it('đóng dấu statusSlug và nhãn hiển thị cho lớp đập', () => {
    const f = new Feature({ geometry: new Point([0, 0]), status: 'nguy_hiem' });
    normalizeLoadedFeatures('dams', [f]);
    expect(f.get('statusSlug')).toBe('nguy_hiem');
    expect(typeof f.get('operationalStatus')).toBe('string');
  });

  it('chạy lại trên lớp đập vẫn giữ nguyên statusSlug', () => {
    const f = new Feature({ geometry: new Point([0, 0]), status: 'nguy_hiem' });
    normalizeLoadedFeatures('dams', [f]);
    const slug1 = f.get('statusSlug');
    const label1 = f.get('operationalStatus');
    normalizeLoadedFeatures('dams', [f]);
    expect(f.get('statusSlug')).toBe(slug1);
    expect(f.get('operationalStatus')).toBe(label1);
  });

  it('feature đã đóng dấu layerKey thì lần gọi thứ hai không ghi lại thuộc tính (guard idempotency)', () => {
    const f = new Feature({ geometry: new Point([0, 0]), name: 'Sông Ba', stream_order: 4 });
    normalizeLoadedFeatures('rivers', [f]);
    expect(f.get('layerKey')).toBe('rivers');

    const setPropertiesSpy = vi.spyOn(f, 'setProperties');
    const unsetSpy = vi.spyOn(f, 'unset');

    normalizeLoadedFeatures('rivers', [f]);

    expect(setPropertiesSpy).not.toHaveBeenCalled();
    expect(unsetSpy).not.toHaveBeenCalled();
  });

  it('bỏ qua feature không có hình học', () => {
    const f = new Feature({ name: 'không toạ độ' });
    expect(() => normalizeLoadedFeatures('dams', [f])).not.toThrow();
    expect(f.get('layerKey')).toBeUndefined();
  });
});
