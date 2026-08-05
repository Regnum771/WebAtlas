# Script đo hiệu năng bản đồ

`profile-map.mjs` chạy một kịch bản cố định trên Chrome hệ thống và ghi lại:

- `firstRenderMs` — tới khi canvas OpenLayers đầu tiên xuất hiện
- `longTaskTotalMs` — tổng thời gian long task trên main thread
- `featuresAfterLoad` / `featuresAfterZoom` — **số feature đã dựng trong mỗi lớp**
  (đây là chỉ số chính: chi phí main thread tỉ lệ với số feature, không phải số byte nén)
- `transfer` — số request và số byte theo từng lớp
- `panFrames` — nhịp khung hình khi pan

## Yêu cầu

- Docker stack đang chạy: `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`
- Dev server đang chạy: `npm run dev:web`
- Chrome hệ thống. Đặt `CHROME_PATH` nếu Chrome không nằm ở đường dẫn mặc định.
  Dự án dùng `puppeteer-core` (KHÔNG dùng `puppeteer` bản đầy đủ — nó tải kèm trình duyệt riêng).

## Chạy

```bash
npm run profile -w @webatlas/web -- --out ket-qua.json
```

Không chạy trong CI; đây là công cụ chạy theo nhu cầu.
