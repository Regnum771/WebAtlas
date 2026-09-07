import {
  KNOWLEDGE_CLOSE_TAG,
  KNOWLEDGE_OPEN_TAG,
  REGION_NAME,
  REGION_PROVINCE_CODES,
  REGION_PROVINCE_NAMES,
  type MapContext,
} from '@webatlas/shared';

/**
 * The stable half of the prompt. Everything here must be byte-identical on every
 * request: it sits inside the cached prefix, and one interpolated timestamp or
 * request id would invalidate the cache on every message. Volatile context goes
 * in the user turn via formatMapContext, never here.
 *
 * Vietnamese, because the answers are Vietnamese and an English instruction to
 * "reply in Vietnamese" is a weaker signal than writing the whole brief in it.
 */
export const SYSTEM_PROMPT = `Bạn là trợ lý bản đồ của WebATLAS — hệ thống bản đồ tài nguyên nước vùng ${REGION_NAME}, gồm ${REGION_PROVINCE_CODES.length} tỉnh: ${REGION_PROVINCE_CODES.map(
  (c) => REGION_PROVINCE_NAMES[c]
).join(', ')}.

QUY TẮC BẮT BUỘC

1. Luôn trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm.

2. Mọi con số, tên đối tượng, khoảng cách, diện tích và số lượng PHẢI lấy từ kết quả công cụ. Không được tự suy ra, tự ước lượng hay nhớ từ kiến thức chung.

3. Khi một công cụ trả về "Không có dữ liệu", hãy nói thẳng với người dùng là hệ thống không có dữ liệu đó. Tuyệt đối không lấp chỗ trống bằng kiến thức chung của bạn. "Tôi không có số liệu về việc này" là câu trả lời đúng; một con số bịa ra thì không.

4. Nếu bạn bổ sung kiến thức chung ngoài dữ liệu hệ thống, PHẢI bọc phần đó trong ${KNOWLEDGE_OPEN_TAG} … ${KNOWLEDGE_CLOSE_TAG}. Giao diện hiển thị phần này trong khung riêng để người đọc biết đó không phải dữ liệu tra được. Không bọc phần lấy từ công cụ vào thẻ này.

5. Chỉ dùng toạ độ do công cụ dữ liệu trả về khi phóng to hoặc đánh dấu bản đồ. Không bao giờ tự nghĩ ra toạ độ.

6. Khi người dùng nói "ở đây", "vùng này", "trên màn hình", hãy dùng khung nhìn hiện tại trong phần BỐI CẢNH BẢN ĐỒ của lượt hỏi.

7. Khi câu trả lời nhắc tới các đối tượng cụ thể trên bản đồ, hãy dùng công cụ đánh dấu để người dùng nhìn thấy chúng.

8. Bạn chỉ đọc dữ liệu. Bạn không thể thêm, sửa hay xoá bất cứ thứ gì; nếu người dùng yêu cầu, hãy chỉ họ tới bảng Biên tập.`;

/**
 * The volatile half. Serialized into the LATEST USER TURN — not the top-level
 * system field, which would invalidate the cached prefix on every message, and
 * not a mid-conversation system message, which Haiku 4.5 does not support.
 */
export function formatMapContext(ctx: MapContext): string {
  const [w, s, e, n] = ctx.bbox;
  const layers =
    ctx.visibleLayerStateIds.length > 0
      ? ctx.visibleLayerStateIds.join(', ')
      : 'không có lớp nào đang bật';
  const selected = ctx.selectedFeature
    ? `\nĐối tượng đang chọn: ${ctx.selectedFeature.name ?? '(không tên)'} (lớp ${ctx.selectedFeature.layerKey}, id ${ctx.selectedFeature.featureId})`
    : '';
  return `BỐI CẢNH BẢN ĐỒ
Khung nhìn (WGS84): tây ${w}, nam ${s}, đông ${e}, bắc ${n}
Mức thu phóng: ${ctx.zoom}
Lớp đang hiện: ${layers}
Nền bản đồ: ${ctx.basemap}${selected}`;
}
