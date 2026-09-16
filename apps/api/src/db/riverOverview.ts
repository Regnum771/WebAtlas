import type { Pool } from 'pg';

/**
 * Làm mới ảnh chụp sông tổng quan (water.rivers_overview).
 *
 * PHẢI gọi mỗi khi thứ mà water.rivers_active TRẢ VỀ thay đổi, vì view đó phụ
 * thuộc phiên bản đang kích hoạt còn bảng vật chất hoá chỉ là ảnh chụp. Quên gọi
 * thì bản đồ ở mức thu nhỏ vẫn vẽ mạng lưới cũ mà không báo gì.
 *
 * Có HAI dịp như vậy:
 *   1. Sau khi nạp dữ liệu mới — ingestRivers gọi sẵn.
 *   2. Sau khi kích hoạt một phiên bản khác — HIỆN CHƯA CÓ đường mã nào làm việc
 *      này; phiên bản được kích hoạt bằng SQL tay. Ai làm việc đó phải tự chạy
 *      lại hàm này (hoặc REFRESH MATERIALIZED VIEW CONCURRENTLY water.rivers_overview).
 *      Ca kiểm thử trong riverOverview.test.ts là chốt chặn cuối.
 *
 * CONCURRENTLY để người đang xem bản đồ không bị khoá trong lúc làm mới; điều
 * kiện của nó là chỉ mục UNIQUE tạo ở migration 1000000000009.
 */
export async function refreshRiverOverview(pool: Pool): Promise<void> {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY water.rivers_overview');
}
