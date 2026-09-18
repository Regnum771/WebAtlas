/* eslint-disable camelcase */
exports.shorthands = undefined;

const LAYERS = [
  'dams', 'rivers', 'lakes', 'stations',
  'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation',
];

/**
 * Đóng dấu đơn vị hành chính lên từng đối tượng.
 *
 * MẢNG chứ không phải một mã: một con sông chảy qua nhiều tỉnh. Cột vô hướng không trả lời
 * được "những sông nào chảy qua Đắk Lắk" — mà đó chính là câu hỏi hay gặp nhất.
 *
 * Đây là phi chuẩn hoá có chủ ý. Quan hệ "đối tượng nằm trong tỉnh nào" là cố định; tính
 * lại bằng phép giao hình học ở mỗi lần hỏi là trả giá lặp đi lặp lại cho một sự thật không
 * đổi. Vùng bất kỳ do người dùng vẽ thì đi đường khác (ROI), không dùng cột này.
 *
 * Giá trị do db/adminStamp.ts tính: khi nạp dữ liệu, và khi một phiên biên tập được ghi.
 * Mặc định '{}' để không bao giờ phải phân biệt NULL với "không thuộc đơn vị nào".
 */
exports.up = (pgm) => {
  for (const layer of LAYERS) {
    pgm.sql(`
      ALTER TABLE water.${layer}
        ADD COLUMN IF NOT EXISTS province_codes text[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS ward_codes     text[] NOT NULL DEFAULT '{}'
    `);
    pgm.sql(`CREATE INDEX IF NOT EXISTS ${layer}_province_codes_index ON water.${layer} USING gin (province_codes)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS ${layer}_ward_codes_index ON water.${layer} USING gin (ward_codes)`);
  }

  // Cột mới nằm ở CUỐI bảng nên CREATE OR REPLACE hợp lệ (Postgres chỉ cho phép thêm cột vào
  // cuối danh sách chiếu). Nếu Postgres từ chối, DROP VIEW rồi CREATE lại — nhưng khi đó phải
  // publish lại GeoServer vì kiểu đối tượng bám theo view.
  for (const layer of LAYERS) {
    pgm.sql(viewSql(layer));
  }
};

function viewSql(layer) {
  return `
    CREATE OR REPLACE VIEW water.${layer}_active AS
    WITH RECURSIVE active AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = '${layer}' AND is_active
    ),
    chain AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN active a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      -- Nearest version in the chain wins per external_id (lowest depth first).
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.${layer} t JOIN chain c ON t.dataset_version_id = c.id
        ORDER BY t.external_id, c.depth
    )
    -- Tombstone check happens *after* DISTINCT ON picks the nearest row, so a
    -- tombstone in a nearer version suppresses an ancestor's stale row rather
    -- than letting it resurface.
    SELECT * FROM resolved WHERE NOT deleted;
  `;
}

exports.down = (pgm) => {
  for (const layer of LAYERS) {
    pgm.sql(`DROP INDEX IF EXISTS water.${layer}_province_codes_index`);
    pgm.sql(`DROP INDEX IF EXISTS water.${layer}_ward_codes_index`);
    pgm.sql(`ALTER TABLE water.${layer} DROP COLUMN IF EXISTS province_codes, DROP COLUMN IF EXISTS ward_codes`);
  }
};
