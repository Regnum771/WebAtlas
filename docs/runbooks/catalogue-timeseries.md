# Danh mục và chuỗi thời gian — sổ tay vận hành

Sổ tay này dành cho người vận hành WebATLAS: chuỗi thời gian (mưa lưới, độ sâu ngập HEC-RAS) đi từ tệp
tải lên tới lớp chạy theo thanh thời gian trên bản đồ, tệp nằm ở đâu, chạy lại thế nào và xoá một mục
Danh mục ra sao. Thiết kế: [đặc tả S1](../superpowers/specs/2026-11-10-catalogue-live-forecast-design.md),
mục 1–2; ngăn xếp nền: [infra/platform/README.md](../../infra/platform/README.md).

## Luồng dữ liệu

1. Người dùng đăng nhập một lần (SSO, Keycloak), mở **Thêm dữ liệu → Từ Danh mục → Tải chuỗi thời gian
   lên** và chọn tệp: ZIP hoặc GeoTIFF theo thời gian, NetCDF-4 (`.nc`, hoặc ZIP nhiều `.nc`) hay kết quả
   HEC-RAS 2D (`.hdf`). Tối đa 2 GB một tệp; các tệp này không tính vào hạn mức 1 GB của Bản của tôi.
2. API lưu tệp thành `workspace.files` (kind `upload`, purpose `timeseries`, tự xoá sau 3 ngày nếu chưa
   nhập) và xếp việc `timeseries_import` cho worker.
3. Worker đọc tệp, ghi một COG cho mỗi thời điểm (EPSG:3857, float32, nodata −9999) vào
   `var/timeseries/ts_<8 ký tự đầu của mã tệp>/`, đăng lên GeoServer của GeoNode thành ImageMosaic
   `geonode:ts_…` có chiều thời gian, đăng ký thành dataset GeoNode của người tải lên (chưa xuất bản,
   chưa duyệt) qua cầu nối `webatlas_bridge`, và ghi ngay dòng `catalogue.resources` (người tải lên thấy
   mục ngay, có nhãn **Chưa duyệt**). Một tệp HEC-RAS cho thêm một raster **độ sâu lớn nhất** ở
   `var/timeseries/ts_…_peak/ts_…_peak.tif`, là mục `raster` thứ hai.
4. Đồng bộ Danh mục của Dagster (`dong_bo_danh_muc`, mỗi phút; mỗi giờ một lần liệt kê đủ) giữ
   `catalogue.resources` khớp với GeoNode: xuất bản, đổi tên, xoá.
5. Trên bản đồ, mục chuỗi thời gian chạy theo thanh thời gian chung; mọi ảnh đi qua proxy
   `GET /api/catalogue/:id/wms` của API (mang token, nên mục chưa xuất bản chỉ chủ của nó xem được).

## Tệp nằm ở đâu

| Cái gì | Ở đâu | Vào git? |
|---|---|---|
| Tệp gốc người dùng tải lên | `var/workspace-files/…` (đường dẫn trong `workspace.files.path`) | Không |
| Các bước COG của một chuỗi | `var/timeseries/ts_xxxxxxxx/ts_xxxxxxxx_<YYYYMMDDTHHMMSSZ>.tif` | Không |
| Raster độ sâu lớn nhất (HEC-RAS) | `var/timeseries/ts_xxxxxxxx_peak/ts_xxxxxxxx_peak.tif` | Không |
| Chỉ mục hạt (granule) của ImageMosaic | bảng `ts_xxxxxxxx` trong CSDL `webatlas_mosaic_index` | — |
| Mục Danh mục | dataset GeoNode (`http://localhost:8000`) + dòng `catalogue.resources` | — |
| Tệp mẫu để kiểm thử | `var/samples/` (`thubon_vugia_10_25.p01.hdf`, `mswep-2025-10.zip`) | Không |

GeoServer đọc `var/timeseries` qua bind mount `/webatlas-timeseries`. Không bao giờ chép tệp tải về thô
(HEC-RAS, MSWEP) vào kho git.

## Lần chạy thật đầu tiên (10/11/2026)

Chạy trên máy phát triển 8 GB (Docker giới hạn 4 GB; GeoNode, Keycloak, GeoServer, PostGIS, worker, API, Vite và
Chrome cùng lúc, máy thường chỉ còn dưới 100 MB RAM trống), tải lên qua giao diện bằng
`verify-catalogue.mjs --upload`:

| Tệp | Cỡ | Tải lên | Việc `timeseries_import` | Kết quả |
|---|---|---|---|---|
| `thubon_vugia_10_25.p01.hdf` (HEC-RAS, mỗi giờ) | 1 068 417 912 B (1,07 GB) | 70 s | 2 300 s (≈ 38 phút: đọc tệp và dựng lưới ô 30 m ≈ 10 phút, 73 bước ≈ 23 phút, đăng GeoServer/GeoNode ≈ 5 phút) | 73 bước, 25/10/2025 00:00 → 28/10/2025 00:00 (UTC), `var/timeseries/ts_f3770c4d/` 73 COG = 60,8 MB; raster độ sâu lớn nhất 1,7 MB |
| `mswep-2025-10.zip` (7 tệp `.nc` ngày 2025296–2025302) | 45 538 933 B | 23 s | 257 s | 7 bước, 23/10 → 29/10/2025 00:00 (UTC), lưới toàn cầu 0,1° không cắt, 7 COG = 42,7 MB (≈ 6 MB/ngày) |

*Sao vào Bản của tôi*: raster độ sâu lớn nhất 30–109 s, mục vector nhỏ 5–50 s (tuỳ tải của máy).

Tên mục HEC-RAS là tiêu đề người dùng gõ cộng nhãn ` (nội suy từ .hdf trên FABDEM)`; raster độ sâu lớn
nhất mang tiêu đề gõ cộng ` – độ sâu lớn nhất`. Thời điểm trong `.hdf` không có múi giờ; worker coi là UTC,
nên trên trình duyệt giờ Việt Nam thanh thời gian hiện 07:00 cho bước 00:00 của mô hình.

Các mục kiểm thử còn để lại trong Danh mục để chạy lại kiểm chứng (xem mục *Xoá một mục Danh mục*):
`Kiểm thử S1 — Độ sâu ngập Thu Bồn – Vu Gia, 25–28/10/2025 (nội suy từ .hdf trên FABDEM)` (`geonode:ts_f3770c4d`),
`… – độ sâu lớn nhất` (`geonode:ts_f3770c4d_peak`), `Kiểm thử S1 — Mưa ngày MSWEP, 23–29/10/2025`
(`geonode:ts_fa7786c6`) và mục vector đã xuất bản `kiem_thu_s1_tram_do` (GeoNode pk 13).

## Chạy lại kiểm chứng trên trình duyệt

Cần: ngăn xếp nền tối thiểu và worker, API, web.

```powershell
docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml up -d keycloak django celery geonode
docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml --profile worker up -d worker
npm run dev -w @webatlas/api      # cổng 3001
npm run dev:web                   # cổng 5173
```

Trên máy 8 GB, để Dagster (webserver, daemon, auth) tắt; khi cần đồng bộ Danh mục, chạy một lần:

```powershell
docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml run --rm --no-deps -T dagster-webserver `
  python -c "from datetime import datetime, timezone; from webatlas_orchestration import catalogue_sync, registry; conn = registry.connect().__enter__(); print(catalogue_sync.run(conn, datetime.now(timezone.utc), full=False))"
```

Kịch bản `apps/web/scripts/verify-catalogue.mjs` (đầu tệp liệt kê đủ các bước) cần hai tài khoản
Keycloak và một mục vector **đã xuất bản** tìm được bằng `kiem_thu_s1` (đổi bằng `VERIFY_VECTOR_QUERY`):

```powershell
$env:VERIFY_SSO_USERNAME = '<KC_DEV_USERNAME>'; $env:VERIFY_SSO_PASSWORD = '<KC_DEV_PASSWORD>'
$env:VERIFY_SECOND_USERNAME = '<tài khoản thứ hai>'; $env:VERIFY_SECOND_PASSWORD = '<mật khẩu>'
npm run verify:catalogue -w @webatlas/web -- --out <thư-mục-ảnh> [--only 1440|768] [--upload]
```

`--upload` tải hai tệp mẫu lên qua giao diện khi các mục kiểm thử chưa có trong Danh mục (lần đầu); các
lần sau dùng lại các mục đó. Trang chạy theo giờ UTC để thanh thời gian đọc đúng giờ của dữ liệu.

Tạo mục vector kiểm thử (một GeoJSON nhỏ) bằng chính API tải lên của GeoNode, rồi xuất bản nó:

```powershell
curl.exe -u "admin:<GEONODE_ADMIN_PASSWORD>" -F "base_file=@kiem_thu_s1_tram_do.geojson;type=application/geo+json" `
  -F action=upload http://localhost:8000/api/v2/uploads/upload          # -> {"execution_id": ...}
curl.exe -u "admin:<GEONODE_ADMIN_PASSWORD>" http://localhost:8000/api/v2/executionrequest/<execution_id>
curl.exe -u "admin:<GEONODE_ADMIN_PASSWORD>" -X PATCH -H "Content-Type: application/json" `
  --data-binary "@pub.json" http://localhost:8000/api/v2/resources/<pk>  # pub.json: {"is_published":true,"is_approved":true}
```

rồi chạy đồng bộ Danh mục một lần (ở trên).

## Xoá một mục Danh mục

Xoá ở GeoNode trước, rồi dọn GeoServer; **không bao giờ xoá store chuỗi thời gian bằng `purge`** (xem
infra/platform/README.md: purge chạy `DROP DATABASE` trên CSDL chỉ mục).

1. Xoá dataset trong GeoNode với tài khoản quản trị (hoặc ở trang của dataset):
   ```powershell
   curl.exe -u "admin:<GEONODE_ADMIN_PASSWORD>" -X DELETE http://localhost:8000/api/v2/resources/<pk>/delete
   ```
   Việc xoá chạy trong Celery: nó gỡ layer và store khỏi GeoServer (không purge với ImageMosaic; **có**
   purge với một GeoTIFF đơn như raster độ sâu lớn nhất, nên tệp `.tif` đó mất theo).
2. Dọn store, layer và bảng chỉ mục của ImageMosaic (không sao nếu GeoNode đã gỡ store):
   ```powershell
   docker compose -p webatlas -f infra/docker-compose.yml --profile tools run --rm -T tools `
     python3 -c "import sys; sys.path.insert(0, 'packages/atlas-data/tools'); from timeseries import geoserver; geoserver.delete_mosaic('ts_xxxxxxxx')"
   ```
   Với raster độ sâu lớn nhất: `geoserver.delete_mosaic('ts_xxxxxxxx_peak')` (store GeoTIFF đơn, cùng hàm).
3. Dòng `catalogue.resources` đi theo ở lần đồng bộ liệt kê đủ (mỗi giờ; hai bước: lần đầu đánh dấu
   `missing_since`, lần sau mới xoá). Liên kết tới mục này trong Bản của tôi khi đó hiện *Không có quyền
   xem hoặc đã bị xoá*.
4. Các tệp bước COG vẫn nằm trong `var/timeseries/ts_xxxxxxxx/`: `delete_mosaic` chỉ gỡ tệp riêng của
   ImageMosaic. Xoá từng tệp `.tif` bằng tay rồi xoá thư mục rỗng (không dùng lệnh xoá đệ quy trên máy
   này).

## Sự cố đã gặp

- **Mưa MSWEP toàn cầu báo "Toạ độ nằm ngoài phạm vi kinh độ/vĩ độ".** Toạ độ float32 của tệp đặt mép dưới
  ở −90,0000122°. Đã sửa (b77a578): mép lệch dưới 1e-4° do làm tròn được kẹp lại vào ±90/±180.
- **`finished_at` của việc thành công sai** (chỉ sau `started_at` vài giây cho một việc 38 phút): ghi bằng
  `now()` trong giao dịch của chính việc. Đã sửa (e343625) bằng `clock_timestamp()`; số liệu thời gian ở
  bảng trên lấy từ trình duyệt.
- **GeoServer không trả lời ở `localhost:8080`** (curl `000`) trong khi trong container vẫn chạy: cổng
  chuyển tiếp của WSL hỏng sau khi khởi động lại. `docker restart webatlas-geoserver-1`.
- **Máy hết RAM.** Lỗi `Connection terminated due to connection timeout` của pool PostgreSQL trong API
  (một lần *Sao vào Bản của tôi* trả 500), trang không tải xong trong 30 s, Chrome treo
  `Runtime.callFunctionOn`. Tắt Dagster; trong lúc chạy kịch bản trình duyệt (không tải lên) có thể tắt
  `django`, `celery`, `geonode` vì bản đồ chỉ đọc `catalogue.resources` và GeoServer; bật lại trước khi
  xoá mục qua GeoNode.
