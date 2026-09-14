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
