# Script đo hiệu năng bản đồ

`profile-map.mjs` chạy một kịch bản cố định trên Chrome hệ thống và ghi lại:

- `firstRenderMs` — tới khi canvas OpenLayers đầu tiên xuất hiện
- `settleMs` / `settleAfterZoomMs` — **thời gian tới khi mọi vector source ngừng nạp**
  (`source.loading === 0`), đo theo ĐIỀU KIỆN chứ không phải thời gian chờ cố định, trần
  60s (`SETTLE_TIMEOUT_MS`). Đây là chỉ số chính: "thời gian tới khi bản đồ dùng được".
  Giá trị `-1` (in ra `TIMEOUT`) nghĩa là chạm trần mà vẫn còn source chưa nạp xong — kết
  quả đó không hợp lệ để làm baseline, đừng dùng nó cho so sánh trước/sau.
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

## Cảnh báo: đừng chạy lặp liên tục

**Không chạy script này trong vòng lặp sát nhau.** GeoServer xuống cấp rõ rệt khi nhận
liên tiếp các request WFS nặng (quan sát thực tế: từ 2.3s lên tới 60s+ mỗi request), và
cần khởi động lại container mới hồi phục:

```bash
docker restart webatlas-geoserver-1
```

Sau khi restart, chờ container khỏe lại và để hệ thống rảnh một lúc trước khi chạy lại.
Nếu một lần chạy cho số liệu vô lý hoặc `settleMs`/`settleAfterZoomMs` báo `TIMEOUT`, đó
thường là dấu hiệu GeoServer đã xuống cấp — restart rồi chạy lại đúng MỘT lần, đừng chạy
dồn dập để "thử lại cho chắc".
