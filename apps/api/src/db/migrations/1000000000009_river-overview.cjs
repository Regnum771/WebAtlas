/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Lớp sông TỔNG QUAN cho các mức thu nhỏ.
 *
 * Vì sao cần: layer_rivers bị chặn tải dưới zoom 8,5 (1:1.570.934) — hợp lý, vì
 * tải cả mạng lưới tốn 17,6 MB, riêng sông chính đã 5,1 MB. Nhưng sau khi dải tỷ
 * lệ nới ra 1:12.800.000 thì có tới NĂM nấc không còn con sông nào, trong một
 * atlas tài nguyên nước.
 *
 * Vì sao rẻ: giá nằm ở SỐ ĐỈNH chứ không phải số đối tượng. Bucket 3 chỉ 1.723
 * đối tượng nhưng 223.052 đỉnh. Ở 1:12.800.000 một điểm ảnh bằng 3,39 km trên
 * thực địa, nên dung sai 0,01° (~1,1 km) nhỏ hơn một phần ba điểm ảnh — mắt
 * không thấy khác, mà còn 4.484 đỉnh / 104 kB, nhẹ đi 34 lần.
 *
 * Vì sao GỘP THEO TÊN: OSM cắt một con sông thành rất nhiều đoạn ngắn — bucket 3
 * có 1.723 đối tượng nhưng chỉ 4.484 đỉnh, tức trung bình 2,6 đỉnh mỗi đối tượng.
 * Sau khi đơn giản hoá thì phần nặng của tải trọng KHÔNG còn là hình học nữa mà
 * là phần bao JSON của mỗi đối tượng (đo được 336 byte/đối tượng). Gộp theo tên
 * đưa 1.723 xuống 279 đối tượng, tải trọng WFS từ 580 kB còn khoảng một phần tư.
 *
 * Đánh đổi: mất id của từng đoạn. Chấp nhận được vì đây là lớp CHỈ ĐỂ HIỂN THỊ ở
 * mức thu nhỏ — không bấm được, không sửa được, và ở 1:12.800.000 thì một điểm
 * ảnh đã là 3,39 km. Lớp sông đầy đủ vẫn giữ nguyên từng đoạn cùng id của nó.
 *
 * Vì sao MATERIALIZED chứ không phải view thường: chạy ST_SimplifyPreserveTopology
 * tại chỗ mất 316 ms cho cả bucket 3, mà chiến lược bbox gọi lại mỗi lần đổi
 * khung nhìn.
 *
 * CẢNH BÁO: rivers_active là view CÓ PHIÊN BẢN (CTE đệ quy trên app.dataset_versions).
 * Bảng vật chất hoá này chỉ là một ảnh chụp; kích hoạt phiên bản khác mà quên
 * refresh thì mức thu nhỏ vẫn phục vụ dữ liệu cũ trong im lặng. Xem
 * refreshRiverOverview và ca kiểm thử đối chiếu đi kèm.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE MATERIALIZED VIEW water.rivers_overview AS
      SELECT COALESCE(name, '') AS name_key,
             name,
             5 AS stream_order,
             ST_LineMerge(ST_Collect(ST_SimplifyPreserveTopology(geom, 0.01))) AS geom
        FROM water.rivers_active
       WHERE stream_order = 5
       GROUP BY COALESCE(name, ''), name
  `);
  pgm.sql(`CREATE INDEX rivers_overview_geom_idx ON water.rivers_overview USING GIST (geom)`);
  // Chỉ mục UNIQUE là điều kiện để REFRESH ... CONCURRENTLY chạy được, nhờ đó
  // lần làm mới không khoá bảng với người đang xem bản đồ.
  // Khoá duy nhất giờ là TÊN (đã gộp), không còn id từng đoạn.
  pgm.sql(`CREATE UNIQUE INDEX rivers_overview_name_idx ON water.rivers_overview (name_key)`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
};
