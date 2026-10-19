import { describe, it, expect } from 'vitest';
import { ApiError } from './apiClient';
import { refusalOf } from './refusal';

describe('refusalOf', () => {
  it('keeps the server message of an out-of-jurisdiction refusal', () => {
    const e = new ApiError(403, 'OUT_OF_JURISDICTION', 'Đối tượng thuộc Đà Nẵng; nhóm của anh/chị chỉ có quyền trong Quảng Ngãi.',
      { unit: '48', permission: 'feature.update', allowed: ['51'] });
    expect(refusalOf(e)).toEqual({ message: e.message, detail: null });
  });

  it('adds a second line naming the review right when that is what was missing', () => {
    const e = new ApiError(403, 'OUT_OF_JURISDICTION', 'Đối tượng thuộc Đà Nẵng; nhóm của anh/chị chỉ có quyền trong Quảng Ngãi.',
      { unit: '48', permission: 'submission.review', allowed: ['51'] });
    expect(refusalOf(e)).toEqual({ message: e.message, detail: 'Thiếu quyền duyệt và xuất bản.' });
  });

  it('keeps the server message of a no-permission refusal', () => {
    const e = new ApiError(403, 'NO_PERMISSION', 'Anh/chị chưa có quyền xoá đối tượng ở đơn vị nào.');
    expect(refusalOf(e)).toEqual({ message: e.message, detail: null });
  });

  it('is null for other errors', () => {
    expect(refusalOf(new ApiError(403, 'FORBIDDEN', 'Insufficient role'))).toBeNull();
    expect(refusalOf(new ApiError(409, 'STALE_EDIT', 'x'))).toBeNull();
    expect(refusalOf(new Error('x'))).toBeNull();
  });
});
