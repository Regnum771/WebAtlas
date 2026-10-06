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

# Script kiểm chứng bố cục khung giao diện

`verify-shell.mjs` mở ứng dụng trên Chrome hệ thống và chứng minh những điều về bố cục mà
test jsdom không chứng minh được (jsdom không dựng bố cục). Mỗi kiểm tra chạy ở hai cỡ cửa
sổ, 1440×900 và 768×900, và in đúng một dòng `PASS`, `FAIL` hoặc `SKIPPED`:

1. Không gì che thanh tỷ lệ (`.map-scaleline`) hay ô toạ độ (`.map-mouseposition`):
   `elementFromPoint` ở tâm và bốn góc (lùi vào 2 px) trúng chính phần tử đó, và hình chữ nhật
   của nó không chạm `.tool-group`, menu công cụ đang mở, `.scale-slider`, `.scale-readout`,
   thông báo nổi. Chạy khi mọi menu đóng (1a) và khi mở `Vùng phân tích` (1b); ở 768, thêm
   một lần với tài khoản quản trị (1c: nhóm công cụ và menu không chạm `.scale-control` lẫn
   thanh tỷ lệ).
2. Trang không cuộn ngang, thanh trên cùng không tràn.
3. Nhóm công cụ, thanh trượt tỷ lệ và ô tỷ lệ nằm trong `.map-stage`.
4. Phông Archivo đã nạp và là phông đầu tiên của `body`.
5. Đã đăng nhập, mở `Trợ lý`: ở 1440, bảng trái rộng 348 px, cột trợ lý 360 px, hai cột không
   chồng nhau, bản đồ rộng ít nhất 600 px (5b: khi mở thêm `Vùng phân tích`, cột trợ lý và menu
   không chạm bảng trái, cột tỷ lệ, thanh tỷ lệ, ô toạ độ); ở 768, cột trợ lý không chồng bảng
   trái và kiểm tra 2 vẫn đúng.
6. Bản đồ sống sót khi điều hướng: canvas của bản đồ là cùng một nút trước và sau khi sang
   `/print` rồi quay lại.
7. Trang in nằm dưới thanh trên cùng, và thanh trên cùng vẫn hiện trên `/print`.
8. Phím Tab tới được thanh trượt tỷ lệ và vòng focus màu vàng (`outline-color`
   `rgb(255, 217, 40)`) hiện ra.
9. Tâm nút kéo của thanh trượt nằm trên vạch của nấc hiện tại (sai lệch tối đa 3 px), đo
   từ điểm ảnh ở hai nấc sau hai lần bấm `Phóng to`.

Trước khi kiểm tra, script chờ tới khi không còn request vẽ bản đồ
(`/gwc|wmts|tile|arcgis|google/`) nào đang chạy trong 4 giây. Mỗi cỡ cửa sổ lưu một ảnh chụp
`verify-shell-<rộng>x<cao>.png` vào thư mục `--out`.

## Yêu cầu

- Docker stack, API (`npm run dev -w @webatlas/api`) và `npm run dev:web` đang chạy.
- Chrome hệ thống; dùng `puppeteer-core` như script đo hiệu năng ở trên.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BASE_URL` | `http://localhost:5173` | Địa chỉ ứng dụng |
| `CHROME_PATH` | `C:/Program Files/Google/Chrome/Application/chrome.exe` | Chrome dùng để chạy |
| `VERIFY_EMAIL` | — | Email tài khoản quản trị cho các kiểm tra đã đăng nhập (1c, 5, 5b). Dùng email dài ít nhất 40 ký tự để kiểm tra thanh trên cùng không tràn. |
| `VERIFY_PASSWORD` | — | Mật khẩu của tài khoản đó |

## Chạy

```bash
VERIFY_EMAIL=... VERIFY_PASSWORD=... npm run verify:shell -w @webatlas/web -- --out <thư-mục>
```

`--out` mặc định là thư mục tạm của hệ điều hành. Script thoát với mã khác 0 khi có bất kỳ
dòng `FAIL` nào.

**`SKIPPED` không phải là đạt.** Thiếu `VERIFY_EMAIL` hoặc `VERIFY_PASSWORD` thì các kiểm tra
đã đăng nhập in `SKIPPED` và script vẫn thoát 0 — lần chạy đó chưa chứng minh được bố cục
khi đã đăng nhập. Chỉ coi là kiểm chứng xong khi mọi dòng đều là `PASS`.
