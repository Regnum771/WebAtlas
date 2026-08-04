/**
 * Ánh xạ tag OSM sang schema thủy văn của dự án.
 *
 * OSM không có bậc Strahler như HydroRIVERS. Thay vào đó ta phân cấp theo LOẠI
 * dòng chảy và ghi vào chính cột `stream_order` sẵn có — nhờ vậy không phải đổi
 * schema, không đổi LAYER_ATTRIBUTE_MAP, và độ rộng nét vẽ hoạt động như cũ.
 *
 * LƯU Ý NGỮ NGHĨA: con số trong `stream_order` giờ KHÔNG còn là bậc Strahler.
 * Nó là hạng theo loại. Vì vậy popup hiển thị nhãn loại (STREAM_ORDER_LABELS)
 * thay vì "Cấp N".
 */
/** Nhãn tiếng Việt cho từng hạng — dùng ở popup và chú giải. */
export declare const STREAM_ORDER_LABELS: Record<number, string>;
/** Các giá trị `waterway` được nhận vào layer sông. */
export declare const RIVER_WATERWAY_VALUES: readonly string[];
/**
 * Hạng dòng chảy từ tag `waterway`, hoặc null nếu không phải dòng chảy
 * (dam/weir/waterfall là công trình; tag lạ bị bỏ qua).
 */
export declare function waterwayToStreamOrder(waterway: unknown): number | null;
/**
 * Loại mặt nước từ tag OSM, hoặc null nếu không phải thủy vực đứng.
 * `landuse=reservoir` được ưu tiên vì nó khẳng định hồ nhân tạo.
 *
 * CỐ Ý LOẠI `water=river` (600 đối tượng trong vùng): đó là MẶT NƯỚC của chính
 * những con sông đã có tim tuyến trong layer `rivers`. Đưa vào layer hồ sẽ khiến
 * một con sông xuất hiện ở cả hai layer, và click vào có thể ra popup sai layer.
 * Tương tự với `water=canal` / `water=stream`.
 */
export declare function osmWaterToLakeType(props: Record<string, unknown>): string | null;
