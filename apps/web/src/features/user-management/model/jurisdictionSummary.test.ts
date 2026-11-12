import { describe, it, expect } from 'vitest';
import { buildUnitTree, type Grant } from '@webatlas/shared';
import { jurisdictionSummary } from './jurisdictionSummary';

const tree = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '20194', level: 'ward', parent: '48', name: 'Xã Điện Hồng' },
]);

describe('jurisdictionSummary', () => {
  it('summary groups permissions per unit set', () => {
    const grants: Grant[] = [
      { permission: 'feature.create', unit: '48' },
      { permission: 'feature.update', unit: '48' },
      { permission: 'feature.delete', unit: '48' },
      { permission: 'map.import', unit: '48' },
      { permission: 'submission.review', unit: '20194' },
    ];
    expect(jurisdictionSummary(grants, tree)).toEqual(['Thêm, sửa, xoá, nhập: Đà Nẵng', 'Duyệt: Xã Điện Hồng']);
  });

  it('no grants reads Chỉ xem', () => {
    expect(jurisdictionSummary([], tree)).toEqual(['Chỉ xem']);
  });

  it('joins several units and falls back to the code without a tree', () => {
    const grants: Grant[] = [
      { permission: 'users.manage', unit: '48' },
      { permission: 'users.manage', unit: '20194' },
    ];
    expect(jurisdictionSummary(grants, tree)).toEqual(['Quản lý người dùng: Xã Điện Hồng, Đà Nẵng']);
    expect(jurisdictionSummary(grants, null)).toEqual(['Quản lý người dùng: 20194, 48']);
  });
});
