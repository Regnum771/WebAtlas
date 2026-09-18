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
  // Each _active view's `SELECT *` expands to include province_codes/ward_codes once up()
  // has run, so Postgres refuses to drop those columns while the view still depends on
  // them. Drop the views first, then the columns, then recreate the views from the same
  // viewSql() used by up() — with the columns gone, that reproduces the pre-migration view.
  //
  // water.rivers_active also has a second, further-downstream dependent: the materialized
  // view water.rivers_overview (migration 009_river-overview), which is built with
  // `... FROM water.rivers_active`. DROP VIEW water.rivers_active fails against it too, so
  // it must be dropped and rebuilt around the same DROP/CREATE, using the identical SQL
  // migration 009's up() uses — this is not migration 016's structure to own, but leaving
  // rivers_overview missing after a rollback would silently break the small-zoom rivers
  // layer, which is worse than the duplication.
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);

  for (const layer of LAYERS) {
    pgm.sql(`DROP VIEW IF EXISTS water.${layer}_active`);
  }
  for (const layer of LAYERS) {
    pgm.sql(`DROP INDEX IF EXISTS water.${layer}_province_codes_index`);
    pgm.sql(`DROP INDEX IF EXISTS water.${layer}_ward_codes_index`);
    pgm.sql(`ALTER TABLE water.${layer} DROP COLUMN IF EXISTS province_codes, DROP COLUMN IF EXISTS ward_codes`);
  }
  for (const layer of LAYERS) {
    pgm.sql(viewSql(layer));
  }

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
  pgm.sql(`CREATE UNIQUE INDEX rivers_overview_name_idx ON water.rivers_overview (name_key)`);
};
