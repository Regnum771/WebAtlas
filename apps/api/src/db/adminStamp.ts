import type pg from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';

/**
 * Khoá lớp là giá trị DUY NHẤT được nội suy vào SQL ở đây, và chỉ sau khi qua danh sách
 * cho phép. Mọi thứ khác là tham số ràng buộc.
 */
function assertKnownLayer(layerKey: EditableLayerKey): void {
  if (!(EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
    throw new Error(`Unknown layer key: ${String(layerKey)}`);
  }
}

/**
 * Tính lại mã tỉnh/xã cho toàn bộ hàng thuộc một phiên bản.
 *
 * Chạy trong giao dịch của người gọi: khi nạp dữ liệu thì cùng giao dịch với phiên bản
 * ingest, khi biên tập thì cùng giao dịch với bản nháp — nên không bao giờ tồn tại trạng
 * thái "đã có đối tượng nhưng chưa có mã".
 *
 * Truy vấn con tương quan chứ không JOIN gộp: mỗi hàng tra chỉ mục GiST của
 * admin.provinces/admin.wards một lần, và mảng giữ được thứ tự ổn định nhờ ORDER BY.
 */
export async function stampAdminCodes(
  client: pg.PoolClient,
  layerKey: EditableLayerKey,
  versionId: string
): Promise<number> {
  assertKnownLayer(layerKey);
  const result = await client.query(
    `UPDATE water.${layerKey} t
        SET province_codes = coalesce((
              SELECT array_agg(p.code ORDER BY p.code)
                FROM admin.provinces p
               WHERE t.geom IS NOT NULL AND ST_Intersects(t.geom, p.geom)), '{}'),
            ward_codes = coalesce((
              SELECT array_agg(w.code ORDER BY w.code)
                FROM admin.wards w
               WHERE t.geom IS NOT NULL AND ST_Intersects(t.geom, w.geom)), '{}')
      WHERE t.dataset_version_id = $1`,
    [versionId]
  );
  return result.rowCount ?? 0;
}
