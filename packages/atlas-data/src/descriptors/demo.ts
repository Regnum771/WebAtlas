import { defineDataset } from '../schema';

/**
 * Tập dữ liệu tối giản để chứng minh bộ chạy hoạt động từ đầu tới cuối mà không cần
 * bất kỳ dữ liệu thật nào. Nó ghi hai dòng vào app.dataset_demo, nên "đã dựng" là thứ
 * quan sát được.
 *
 * Bảng do migration 1000000000013 tạo, KHÔNG phải do stage ở đây: quy ước của repo là
 * migration tạo bảng, mã đường ống chỉ đổ dữ liệu. Hai stage chứ không phải một, để
 * chứng minh thứ tự stage trong cùng một tập dữ liệu.
 */
export const demo = defineDataset({
  id: 'demo',
  kind: 'derived',
  lineage: {
    statement: 'Bảng tổng hợp tối giản, sinh ra tại chỗ để kiểm chứng sổ đăng ký.',
    licence: 'CC0-1.0',
    sources: [],
  },
  stages: [
    {
      type: 'sql',
      statement: `INSERT INTO app.dataset_demo (id, note)
                  VALUES (1, 'materialised by the atlas runner')
                  ON CONFLICT (id) DO NOTHING`,
    },
    {
      type: 'sql',
      statement: `INSERT INTO app.dataset_demo (id, note)
                  VALUES (2, 'second stage, proving in-dataset stage order')
                  ON CONFLICT (id) DO NOTHING`,
    },
  ],
});
