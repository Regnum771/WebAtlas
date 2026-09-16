/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Lý lịch nguồn theo hình dạng ISO 19115, bắt buộc cho MỌI tập dữ liệu.
 *
 * Thay cho basemap.dataset_sources, vốn chỉ phủ được basemap.* và phải cập nhật bằng
 * tay — nên nó đúng cho tới khi có người quên. Ở đây các bước xử lý do chính bộ chạy
 * ghi ra, nên lý lịch không thể lệch khỏi thực tế.
 *
 * Vì sao nằm ở `app` chứ không phải `basemap`: nó mô tả mọi tập dữ liệu, kể cả water.*.
 *
 * Bảng cũ basemap.dataset_sources KHÔNG bị xoá ở migration này — nó được gỡ sau khi
 * các tập dữ liệu basemap đã chuyển sang sổ đăng ký (bước 4 của lộ trình di trú).
 *
 * app.dataset_demo là giàn giáo cho tập dữ liệu `demo` dùng để chứng minh bộ chạy. Tạo
 * nó ở đây chứ không để stage sql của bộ chạy tự tạo, vì quy ước của repo này là
 * migration tạo bảng còn mã đường ống chỉ đổ dữ liệu vào. Gỡ cùng tập dữ liệu demo khi
 * các tập dữ liệu thật đã chuyển sang sổ đăng ký.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_lineage (
      dataset_id text PRIMARY KEY,
      statement   text NOT NULL,
      -- NOT NULL có chủ đích: một lớp không rõ giấy phép thì không xuất bản được.
      licence     text NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_lineage_source (
      id         bigserial PRIMARY KEY,
      dataset_id text NOT NULL REFERENCES app.dataset_lineage(dataset_id) ON DELETE CASCADE,
      citation   text NOT NULL,
      licence    text NOT NULL,
      uri        text,
      resolution text
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS dataset_lineage_source_dataset_idx
             ON app.dataset_lineage_source (dataset_id)`);

  // ON DELETE RESTRICT (không phải CASCADE): lịch sử xử lý là dấu vết xuất xứ của dữ
  // liệu có giấy phép công khai và không được phép bị một lệnh xoá nhầm âm thầm xoá
  // sạch. Muốn gỡ một tập dữ liệu thì phải xử lý lịch sử của nó có chủ đích (ví dụ xoá
  // rõ ràng các bước trước), chứ không để nó biến mất theo.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_lineage_step (
      id          bigserial PRIMARY KEY,
      dataset_id  text NOT NULL REFERENCES app.dataset_lineage(dataset_id) ON DELETE RESTRICT,
      description text NOT NULL,
      tool        text,
      ran_at      timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS dataset_lineage_step_dataset_idx
             ON app.dataset_lineage_step (dataset_id, ran_at DESC)`);

  // Trạng thái theo TỪNG STAGE, không phải từng tập dữ liệu: sửa một phép ánh xạ cột
  // phải khiến đúng stage đó chạy lại, mà không đụng tới một lần tải DEM 40 phút.
  //
  // Khoá ngoại tới dataset_lineage (CASCADE): trạng thái stage cho một dataset_id
  // không có lý lịch phải bị từ chối ngay — id gõ nhầm không được âm thầm tạo trạng
  // thái mồ côi. Xoá tập dữ liệu thì dọn luôn trạng thái build của nó, để một tập dữ
  // liệu đăng ký lại không thừa hưởng trạng thái "ok" cũ và bỏ qua việc cần chạy lại.
  // Hệ quả bộ chạy phải tuân theo: lý lịch phải được upsert trước khi ghi bất kỳ
  // trạng thái stage hay bước xử lý nào (kế hoạch của bộ chạy đã làm đúng thứ tự này).
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_stage_state (
      dataset_id  text NOT NULL REFERENCES app.dataset_lineage(dataset_id) ON DELETE CASCADE,
      stage       text NOT NULL,
      input_hash  text NOT NULL,
      status      text NOT NULL CHECK (status IN ('ok', 'failed')),
      produced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (dataset_id, stage)
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_demo (
      id   integer PRIMARY KEY,
      note text NOT NULL
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS app.dataset_demo');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_stage_state');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_lineage_step');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_lineage_source');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_lineage');
};
