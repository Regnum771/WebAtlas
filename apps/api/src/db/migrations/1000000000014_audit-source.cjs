/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Nguồn của một lần sửa dữ liệu (phản hồi giám sát 2026-09-17): cập nhật số liệu qua
 * trợ lý phải kèm tài liệu nguồn và người cung cấp. Lưu cạnh before/after trên chính
 * dòng audit để một lần sửa và bằng chứng của nó không thể tách rời.
 *
 * Nullable: sửa thủ công trong ngăn Biên tập chưa bắt buộc hai trường này.
 */
exports.up = (pgm) => {
  pgm.addColumns({ schema: 'app', name: 'audit_log' }, {
    source_document: { type: 'text' },
    source_provider: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns({ schema: 'app', name: 'audit_log' }, ['source_document', 'source_provider']);
};
