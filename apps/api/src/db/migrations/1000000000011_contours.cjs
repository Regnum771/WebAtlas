/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Đường đồng mức, dẫn xuất từ basemap.dem_region.
 *
 * Vì sao là BẢNG chứ không phải view: ST_Contour trên một ô 1 độ mất 28 giây, mà lớp này
 * được phục vụ theo từng tile. Tính lại mỗi lần vẽ là không tưởng.
 *
 * Vì sao nằm ở `basemap`: đây là dữ liệu tham chiếu, không có phiên bản, không sửa tay —
 * giống dem_region, khác hẳn các lớp chuyên đề trong `water`.
 *
 * Bảng rỗng sau khi migrate. Dữ liệu do `npm run contours:generate -w @webatlas/api` sinh
 * ra, và cần DEM đã nạp trước (xem docs/runbooks/elevation-dem.md).
 */
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS basemap');
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS basemap.contours (
      id          bigserial PRIMARY KEY,
      interval_m  integer NOT NULL,
      elevation_m real    NOT NULL,
      -- Đường cái: cứ 5 đường thì 1, vẽ đậm hơn và là đường duy nhất được ghi nhãn.
      -- Tính sẵn ở đây chứ không tính trong SLD: biểu thức modulo trong bộ lọc SLD
      -- chạy lại cho từng đối tượng ở mỗi tile.
      is_index    boolean NOT NULL,
      geom        geometry(MultiLineString, 4326) NOT NULL
    )
  `);
  // Xuất xứ dữ liệu tham chiếu. water.* có app.dataset_versions; basemap.* trước nay
  // không có gì — không nguồn, không giấy phép, không ngày nạp. Với FABDEM (phi thương
  // mại) nằm cạnh dữ liệu OSM (ODbL) trong cùng một schema, đây là vấn đề tuân thủ giấy
  // phép chứ không phải chuyện gọn gàng.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS basemap.dataset_sources (
      name       text PRIMARY KEY,
      source     text NOT NULL,
      licence    text NOT NULL,
      url        text,
      script     text,
      loaded_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`
    INSERT INTO basemap.dataset_sources (name, source, licence, url, script) VALUES
      ('dem_region', 'FABDEM V1-2 (Copernicus GLO-30, bare earth)', 'CC BY-NC-SA 4.0 (phi thương mại)',
       'https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn', 'scripts/prep_dem.py + scripts/load-dem.sh'),
      ('contours', 'Dẫn xuất từ basemap.dem_region', 'CC BY-NC-SA 4.0 (kế thừa từ FABDEM)',
       NULL, 'src/scripts/generateContours.ts')
    ON CONFLICT (name) DO UPDATE
       SET source = EXCLUDED.source, licence = EXCLUDED.licence,
           url = EXCLUDED.url, script = EXCLUDED.script, loaded_at = now()
  `);

  pgm.sql('CREATE INDEX IF NOT EXISTS contours_geom_idx ON basemap.contours USING GIST (geom)');
  // Mỗi yêu cầu tile đều lọc theo interval_m trước rồi mới tới bbox.
  pgm.sql('CREATE INDEX IF NOT EXISTS contours_interval_idx ON basemap.contours (interval_m)');
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS basemap.contours');
  // dataset_sources được giữ lại: nó mô tả cả dem_region, vốn không thuộc migration này.
  pgm.sql("DELETE FROM basemap.dataset_sources WHERE name = 'contours'");
};
