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

# Script kiểm chứng khung màn hình bản đồ (K3)

`verify-map-shell.mjs` mở ứng dụng trên Chrome và chứng minh những điều về bố cục mà test jsdom
không chứng minh được (jsdom không dựng bố cục), ở ba cỡ cửa sổ 768×900, 1100×900 và 1440×900.
Mỗi kiểm tra in đúng một dòng `PASS`, `FAIL` hoặc `SKIPPED`:

1. Thanh đầu cao 44 px, không tràn; trang không cuộn ngang.
2. Bảng mục lục rộng 312 px, cách đỉnh và mép trái sân khấu 8 px, dừng cách thanh trạng thái ít
   nhất 8 px.
3. Thanh trạng thái (R8) nằm dọc mép dưới sân khấu, cao 32 px, không bị cắt, và chính nó là thứ
   con trỏ chạm ở hai đầu và ở nút kéo của thanh tỷ lệ: khi mọi menu đóng; khi lần lượt mở từng
   menu công cụ (3a); khi đang hiện một thông báo (3b, gọi `showToast` qua máy chủ dev).
4. Mỗi menu công cụ nằm trong sân khấu, không chạm thanh trạng thái, bảng mục lục và các ngăn
   công cụ.
5. `Ctrl K` mở bảng lệnh và Escape đóng nó.
6. Đã đăng nhập (cần `VERIFY_EMAIL`, `VERIFY_PASSWORD`, nếu không in `SKIPPED`): thanh đầu không
   tràn với tên tài khoản dài (6a); mở Trợ lý, thanh trạng thái vẫn không bị che (6b).

Mỗi cỡ cửa sổ lưu một ảnh `verify-map-shell-<rộng>.png` (chụp khi đang hiện thông báo) vào `--out`.

## Yêu cầu

- Docker stack, API (`npm run dev -w @webatlas/api`) và `npm run dev:web` đang chạy (cần máy chủ
  dev, không phải bản build).
- Chrome; dùng `puppeteer-core` như script đo hiệu năng ở trên.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BASE_URL` | `http://localhost:5173` | Địa chỉ ứng dụng |
| `CHROME_PATH` | `C:/Program Files/Google/Chrome/Application/chrome.exe` | Chrome dùng để chạy |
| `VERIFY_EMAIL` | — | Email tài khoản quản trị cho kiểm tra 6. Dùng email dài ít nhất 40 ký tự để kiểm tra thanh đầu không tràn (tên tài khoản trống thì nút hiện email). |
| `VERIFY_PASSWORD` | — | Mật khẩu của tài khoản đó |

## Chạy

```bash
VERIFY_EMAIL=... VERIFY_PASSWORD=... npm run verify:map-shell -w @webatlas/web -- --out <thư-mục>
```

`--out` mặc định là thư mục tạm của hệ điều hành. Script thoát với mã khác 0 khi có bất kỳ
dòng `FAIL` nào. **`SKIPPED` không phải là đạt**: chỉ coi là kiểm chứng xong khi mọi dòng là `PASS`.

`verify-shell.mjs` (khung trước K3) đã bỏ cùng các kiểm tra cũ của nó.

# Ảnh chụp kiểu dáng phần cũ

`verify-legacy-styles.mjs` chứng minh các màn hình cũ không đổi giao diện khi chuyển sang
Tailwind và shadcn: nó đọc kiểu dáng tính toán (`getComputedStyle`) của mọi phần tử trên các
trang cũ ở 1440×900, rồi so với ảnh chụp đã lưu. Bỏ qua mọi phần tử `[data-slot]` cùng cây con
của nó (các thành phần mới được phép đổi) và `.toast-host`. Trang chưa đăng nhập: `/`,
`/ban-do`, `/du-lieu`; đã đăng nhập (cần `VERIFY_EMAIL`, `VERIFY_PASSWORD`, nếu không in
`SKIPPED`): `/ban-do`, `/ho-so`, `/quan-ly/nhom-quyen`, `/quan-ly/tu-dien`.

```bash
npm run verify:legacy-styles -w @webatlas/web -- --save ../../.superpowers/k2-legacy-baseline.json
npm run verify:legacy-styles -w @webatlas/web -- --compare ../../.superpowers/k2-legacy-baseline.json
```

Thoát với mã 1 khi có khác biệt (in tối đa 50 dòng). Cần Docker stack, API và `npm run dev:web`.

Ảnh chụp không ghi được: phần tử giả (`::before`, `::after`, `::placeholder`), trạng thái hover và
focus, khổ màn hình khác 1440, hộp thoại và thông báo (chúng không mở trên các trang này). Lớp
`legacy-compat` phản chiếu toàn bộ preflight để che những chỗ đó. Các khác biệt đã biết khi so với
ảnh chụp ghi trước K2 (`aa161c5`):

- `missing:` cho các nút `button.btn` cũ và biểu tượng bên trong: K2 dựng lại `Button` trên shadcn
  (`data-slot`), nên script không còn duyệt chúng;
- `missing:` cho cả cây `header.top-bar` từ K3 Task 2: thanh đầu mới mang `data-slot="app-header"`;
- các hàng mới trong bảng lịch sử `/quan-ly/tu-dien` (dữ liệu, không phải kiểu dáng).

Khác biệt `margin-left` của `.top-bar-search` trong K2 đã hết khi K3 dựng lại thanh đầu. Khi một màn
hình đã chuyển trong K3, phép so sánh không còn áp dụng cho nó.

# Thay đổi bộ chọn từ K2

Các thành phần dùng chung giờ dựng trên shadcn/Radix và Sonner, nên các script kiểm chứng tìm
chúng theo vai trò hoặc `data-slot`, không theo lớp CSS cũ:

| Cũ | Mới |
|---|---|
| `.dialog` | `:is([role="dialog"],[role="alertdialog"])` — hộp xác nhận là `alertdialog` |
| `.toast-host > .toast.bad` | `.toast-host [data-slot="toast"][role="alert"]` |
| `.toast-host > *` | `.toast-host [data-sonner-toast]` |
| `.spin` | `[data-slot="spinner"]` |
| `.btn.on-green` | `[data-slot="button"][data-variant="inverse"]` |

Khi một hộp thoại Radix mở, phần còn lại của trang bị ẩn khỏi công cụ đọc màn hình và không nhận
con trỏ; script nào cần bấm phía sau hộp thoại phải đóng nó trước.

Các kiểm tra đã cũ trước K2 (vẫn FAIL như trên mã trước K2, cần sửa script riêng):
`verify:dictionary` bước 2–5. (`verify:shell` đã được `verify:map-shell` thay trong K3.)

# Ảnh chụp bốn lớp cho trang chủ (K5)

Phần mở đầu của trang chủ xếp chồng bốn ảnh WebP cùng phạm vi (vùng chạy HEC-RAS Thu Bồn – Vu Gia 10/2025),
đã commit trong `src/pages/trang-chu/assets/`: địa hình (bóng đổ từ FABDEM trong PostGIS và đường đồng mức
100 m), nền bản đồ (đúng chồng lớp mà bản đồ vẽ), mạng sông (ba bậc theo loại), độ sâu ngập lớn nhất (thang tím).
Chạy lại bằng tay khi dữ liệu đổi, trong image tools, ghi vào cây làm việc cần cập nhật:

```bash
docker compose -p webatlas -f infra/docker-compose.yml --profile tools run --rm -T --no-deps \
  --user $(id -u):$(id -g) tools \
  python3 packages/atlas-data/tools/hub/snapshots.py --out apps/web/src/pages/trang-chu/assets
```

`--flood-layer` chọn lớp độ sâu khác (mặc định `geonode:ts_7cba03198bc64faf_peak`). Kiểm thử phần thuần:
`python3 packages/atlas-data/tools/hub/test_snapshots.py`. Chưa có lớp lưu vực nên lớp thứ ba chỉ là mạng sông.
