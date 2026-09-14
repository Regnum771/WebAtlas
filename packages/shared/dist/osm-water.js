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
/** waterway -> hạng dùng cho độ rộng nét. Chỉ dòng chảy, không gồm công trình. */
const WATERWAY_ORDER = {
    river: 5, // sông chính
    canal: 4, // kênh đào (công trình thủy lợi)
    stream: 2, // suối
    ditch: 1, // mương dẫn
    drain: 1, // mương tiêu — cùng hạng với ditch (khảo sát OSM: 245 đối tượng trong vùng)
};
/** Nhãn tiếng Việt cho từng hạng — dùng ở popup và chú giải. */
export const STREAM_ORDER_LABELS = {
    5: 'Sông chính',
    4: 'Kênh đào',
    2: 'Suối',
    1: 'Mương', // gồm cả ditch (mương dẫn) và drain (mương tiêu)
};
/** Các giá trị `waterway` được nhận vào layer sông. */
export const RIVER_WATERWAY_VALUES = Object.keys(WATERWAY_ORDER);
/**
 * Hạng dòng chảy từ tag `waterway`, hoặc null nếu không phải dòng chảy
 * (dam/weir/waterfall là công trình; tag lạ bị bỏ qua).
 */
export function waterwayToStreamOrder(waterway) {
    if (typeof waterway !== 'string')
        return null;
    return WATERWAY_ORDER[waterway] ?? null;
}
/**
 * Loại mặt nước từ tag OSM, hoặc null nếu không phải thủy vực đứng.
 * `landuse=reservoir` được ưu tiên vì nó khẳng định hồ nhân tạo.
 *
 * CỐ Ý LOẠI `water=river` (600 đối tượng trong vùng): đó là MẶT NƯỚC của chính
 * những con sông đã có tim tuyến trong layer `rivers`. Đưa vào layer hồ sẽ khiến
 * một con sông xuất hiện ở cả hai layer, và click vào có thể ra popup sai layer.
 * Tương tự với `water=canal` / `water=stream`.
 */
export function osmWaterToLakeType(props) {
    // Dòng chảy vẽ dạng vùng — đã có trong layer rivers, không nhân bản sang lakes.
    if (props.water === 'river' || props.water === 'canal' || props.water === 'stream')
        return null;
    if (props.landuse === 'reservoir' || props.water === 'reservoir')
        return 'Hồ chứa';
    if (props.water === 'lake')
        return 'Hồ tự nhiên';
    if (props.water === 'pond')
        return 'Ao';
    if (props.water === 'basin')
        return 'Bể chứa';
    if (props.natural === 'water')
        return 'Mặt nước';
    return null;
}
