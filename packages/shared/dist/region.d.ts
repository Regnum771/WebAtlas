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
export declare const REGION_PROVINCE_CODES: readonly ["48", "51", "52", "56", "66", "68"];
/** Tên vùng để hiển thị trên giao diện. */
export declare const REGION_NAME = "Nam Trung B\u1ED9 & T\u00E2y Nguy\u00EAn";
/** Tên tỉnh theo mã — để thông báo lỗi và báo cáo đọc được. */
export declare const REGION_PROVINCE_NAMES: Record<string, string>;
/** Mã tỉnh này có thuộc vùng công tác không? */
export declare function isRegionProvince(code: unknown): boolean;
