/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * `basemap.dataset_sources.licence` chỉ ghi TÊN giấy phép ("CC BY-NC-SA 4.0 (phi thương
 * mại)"), không phải câu ghi công bắt buộc phải hiển thị. Ai muốn dựng thêm một nơi hiển
 * thị ghi công (chip, trang about, báo cáo...) không có chỗ nào trong CSDL để đọc ra đúng
 * câu chữ — phải quay lại đọc mã nguồn hoặc docs/runbooks/*.md, và hai nơi đó có thể
 * lệch nhau (xem I2/I3 trong final-review-fixes.md — đúng kiểu lệch mà việc này ngăn).
 *
 * Cột nullable vì hai lớp con nguoi khac (nếu thêm sau, ví dụ dữ liệu OSM/ODbL) có thể
 * không cần câu ghi công dài dòng ngay lập tức; NOT NULL sẽ chặn INSERT của những dòng đó.
 *
 * Câu ghi công dùng đúng nguyên văn đã có ở CONTOUR_ATTRIBUTION (contours.ts) và
 * docs/runbooks/elevation-dem.md — không diễn giải lại, vì đây là điều kiện giấy phép.
 *
 * Hằng số dưới đây là một BẢN CHỤP tại thời điểm viết migration này, CỐ Ý không liên
 * kết với legend.ts hay docs/runbooks/elevation-dem.md (không import, không đọc file
 * lúc chạy migrate hay lúc test). Một migration là bản ghi lịch sử tại một thời điểm —
 * sửa lại giá trị ở đây sau khi đã chạy tương đương với viết lại lịch sử. Nếu câu ghi
 * công FABDEM từng thay đổi, hành động đúng là tạo MIGRATION MỚI để UPDATE lại hàng dữ
 * liệu, không sửa file này (RE-REVIEW ROUND 2, R3 — controller decision: không gắn
 * guard runbook vào đây, vì guard đó sẽ vỡ vĩnh viễn ngay sau lần đổi câu chữ hợp lệ
 * đầu tiên và ép ai đó phải viết lại lịch sử migration).
 */
const FABDEM_ATTRIBUTION =
  'FABDEM is produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018.';

exports.up = (pgm) => {
  pgm.addColumn(
    { schema: 'basemap', name: 'dataset_sources' },
    { attribution: { type: 'text' } }
  );

  // Nguyên văn không chứa dấu nháy đơn nên nội suy thẳng vào chuỗi SQL là an toàn;
  // vẫn định nghĩa hằng số ở trên để up/down và test có đúng MỘT nguồn sự thật.
  pgm.sql(`
    UPDATE basemap.dataset_sources
       SET attribution = '${FABDEM_ATTRIBUTION}'
     WHERE name IN ('dem_region', 'contours')
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn({ schema: 'basemap', name: 'dataset_sources' }, 'attribution');
};
