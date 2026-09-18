/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Ranh giới hành chính (tỉnh, xã/phường) theo đơn vị sau sáp nhập 01/7/2025.
 *
 * Vì sao có schema riêng `admin`, không nhét vào `basemap`: đây là dữ liệu có thẩm quyền —
 * dùng để đóng dấu mã hành chính lên từng đối tượng và để trả lời "bao nhiêu đập ở Đắk Lắk".
 * `basemap` là dữ liệu tham chiếu nhập từ OSM, do script nạp, không ai coi là căn cứ.
 *
 * Không đánh phiên bản: ranh giới đổi rất hiếm, và khi đổi thì đi qua sổ đăng ký dữ liệu
 * (packages/atlas-data) chứ không sửa tay. Bảng rỗng sau khi migrate; `npm run seed` nạp
 * từ hai tệp GeoJSON đã commit trong apps/web/public (xem db/seeds/adminBoundaries.ts).
 *
 * ĐỘ CHÍNH XÁC: hình học đã được giản lược ~11 m (fetch-boundaries.mjs: dung sai 0,0001°,
 * làm tròn 5 chữ số). Đối tượng nằm sát ranh giới có thể bị gán sang đơn vị kế bên. Đủ dùng
 * để đếm và lọc; KHÔNG dùng cho mục đích pháp lý hay đo đạc theo ranh giới.
 */
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS admin');

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS admin.provinces (
      code      text PRIMARY KEY,
      name      text NOT NULL,
      name_en   text,
      full_name text,
      area_km2  numeric,
      geom      geometry(MultiPolygon, 4326) NOT NULL
    )
  `);

  // ON DELETE RESTRICT: xoá một tỉnh khi còn xã tham chiếu tới là lỗi dữ liệu, không phải
  // thao tác hợp lệ — cùng quy ước với app.dataset_lineage_step.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS admin.wards (
      code          text PRIMARY KEY,
      province_code text NOT NULL REFERENCES admin.provinces(code) ON DELETE RESTRICT,
      name          text NOT NULL,
      name_en       text,
      full_name     text,
      area_km2      numeric,
      geom          geometry(MultiPolygon, 4326) NOT NULL
    )
  `);

  pgm.sql('CREATE INDEX IF NOT EXISTS provinces_geom_index ON admin.provinces USING gist (geom)');
  pgm.sql('CREATE INDEX IF NOT EXISTS wards_geom_index ON admin.wards USING gist (geom)');
  pgm.sql('CREATE INDEX IF NOT EXISTS wards_province_code_index ON admin.wards (province_code)');
};

exports.down = (pgm) => {
  pgm.sql('DROP SCHEMA IF EXISTS admin CASCADE');
};
