# Vùng công tác, OSM waterways và ranh giới hành chính mới — Thiết kế

**Ngày:** 2026-08-04
**Trạng thái:** Đã duyệt thiết kế, chờ lập kế hoạch triển khai

## Vấn đề

Ba yêu cầu độc lập trên bề mặt nhưng quy về một khái niệm chung:

1. **Dữ liệu sông sai vị trí.** HydroRIVERS suy ra từ DEM 15 arc-giây (~450 m/ô) nên đường sông chạy theo bậc thang trên lưới và dao động quanh lòng sông thật. Quan sát thực tế: đường sông cắt qua lại ranh giới xã/phường vốn được số hóa từ chính con sông đó. Đây không phải lỗi phép chiếu — lệch dao động quanh vị trí đúng chứ không dịch đều một hướng.

2. **Dữ liệu chuyên đề vượt quá địa bàn công tác.** Sau bước cắt theo ranh giới quốc gia (commit trước), dữ liệu vẫn phủ toàn Việt Nam trong khi dự án chỉ phục vụ vùng Nam Trung Bộ & Tây Nguyên.

3. **Ranh giới hành chính lỗi thời.** Repo dùng GADM 4.1 (63 tỉnh, 11.163 xã) trong khi Việt Nam đã sáp nhập còn 34 tỉnh/thành từ 01/7/2025. Layer đang đặt tên `layer_provinces_2026` / `layer_wards_2026` — tên gợi ý ranh giới mới nhưng nội dung là ranh giới cũ.

Cả ba đều xoay quanh: *địa bàn nào* và *gọi tên thế nào*.

## Nguyên tắc phân tách hai lớp

Điểm cốt lõi của thiết kế: **nền và ranh giới hiển thị cả nước, dữ liệu chuyên đề chỉ trong vùng.**

| Lớp | Phạm vi | Nguồn |
|---|---|---|
| Nền (basemap) | Toàn cầu | CARTO / Esri (không đổi) |
| Ranh giới tỉnh | **Cả nước** (34 tỉnh) | vietnamese-provinces-database |
| Ranh giới xã | 6 tỉnh trong vùng | vietnamese-provinces-database |
| 8 layer chuyên đề | **Chỉ 6 tỉnh** | Cắt lúc chuẩn bị dữ liệu |

## Vùng công tác

Nam Trung Bộ & Tây Nguyên theo đơn vị hành chính sau sáp nhập — 6 tỉnh:

| Mã | Tên mới | Gộp từ |
|---|---|---|
| 48 | Đà Nẵng | Đà Nẵng + Quảng Nam |
| 51 | Quảng Ngãi | Quảng Ngãi + Kon Tum |
| 52 | Gia Lai | Gia Lai + Bình Định |
| 66 | Đắk Lắk | Đắk Lắk + Phú Yên |
| 56 | Khánh Hòa | Khánh Hòa + Ninh Thuận |
| 68 | Lâm Đồng | Lâm Đồng + Đắk Nông + Bình Thuận |

Phần lớn các tỉnh mới gộp một tỉnh duyên hải với một tỉnh Tây Nguyên, nên vùng theo đơn vị mới gọn hơn hẳn và ranh giới vùng gần trùng khớp tự nhiên.

**Mã tỉnh đã xác minh** bằng cách liệt kê thư mục `json/geojson/` của kho nguồn: đúng 34 thư mục, trong đó có `48_da_nang`, `51_quang_ngai`, `52_gia_lai`, `56_khanh_hoa`, `66_dak_lak`, `68_lam_dong`. Sáu mã trên khớp hoàn toàn.

### Nguồn sự thật duy nhất

`packages/shared/src/region.ts`:

```ts
export const REGION_PROVINCE_CODES = ['48','51','52','66','56','68'] as const;
export const REGION_NAME = 'Nam Trung Bộ & Tây Nguyên';
```

Đặt ở `packages/shared` vì API, script chuẩn bị dữ liệu và frontend đều cần. Đổi vùng = sửa một dòng rồi chạy lại pipeline.

## Kiến trúc: lọc tại nguồn

Ba phương án đã cân nhắc:

- **A. Cắt lúc seed** *(chọn)* — DB chỉ chứa đối tượng trong vùng.
- **B. View PostGIS theo vùng** — giữ dữ liệu toàn quốc, cắt lúc phục vụ. Vi phạm vế "chỉ **lưu**"; DB phình; cắt hình học lúc chạy làm WFS chậm.
- **C. Lọc ở frontend** — vẫn tải toàn bộ qua mạng rồi vứt. Không thỏa vế nào.

Chọn A vì yêu cầu nói rõ "chỉ **lưu**, hiển thị và phục vụ", và vì nó đi đúng lối mòn đã có (`clip-to-vietnam.mjs` + version ingest).

Hệ quả: đổi vùng phải chạy lại ingest, không bật/tắt tức thì. Chấp nhận được — vùng công tác hiếm khi đổi.

## Ranh giới hành chính mới

### Nguồn (đã xác minh)

[thanglequoc/vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database)

| Tiêu chí | Kết quả |
|---|---|
| License | MIT |
| Phạm vi | 34 tỉnh + 3.321 xã, đều là polygon |
| CRS | EPSG:4326 |
| Nguồn gốc | NXB Tài nguyên–Môi trường và Bản đồ (Bộ NN&MT) |
| Cập nhật | Theo nghị quyết 30/2026/QH16 |
| Thuộc tính | `code`, `name`, `nameEn`, `fullName`, `codeName`, `areaKm2` |
| Kích thước | ~400 KB/tỉnh |

Kiểm chứng: tải Đà Nẵng, `areaKm2: 11859.59` — khớp Đà Nẵng + Quảng Nam sau sáp nhập.

Cấu trúc kho: `json/geojson/{code}_{codeName}/{code}_{codeName}.geojson` + thư mục con `wards/`. Cho phép tải chọn lọc thay vì tải cả nước rồi vứt.

### Script `fetch-boundaries.mjs`

Chạy một lần, kết quả commit như generated artifact (giống `prep-hydrosheds.sh`):

- `provinces-34.geojson` — ghép 34 file tỉnh
- `wards-region.geojson` — ghép xã của 6 tỉnh trong vùng

#### Bắt buộc phải đơn giản hóa hình học

Đo thực tế trên kho nguồn (không phải ước lượng):

| Tỉnh | Số xã | Dung lượng thô |
|---|---|---|
| Đà Nẵng | 94 | 14,2 MB |
| Quảng Ngãi | 96 | 17,9 MB |
| Gia Lai | 135 | 34,3 MB |
| Khánh Hòa | 65 | 13,5 MB |
| Đắk Lắk | 102 | 33,7 MB |
| Lâm Đồng | 124 | 43,7 MB |
| **Tổng** | **616** | **157,3 MB** |

157 MB gấp 5 lần file GADM 31 MB đang thay thế — nạp vào trình duyệt sẽ làm treo app. Kho nguồn **không có bản giản lược** (đã kiểm tra README).

Nguyên nhân: mỗi xã ~2.487 điểm với toạ độ ~14 chữ số thập phân, vượt xa độ phân giải màn hình.

Xử lý bắt buộc trong `fetch-boundaries.mjs` — đo trên một xã Khánh Hòa (212 KB gốc):

| Xử lý | Kích thước | Giảm |
|---|---|---|
| Gốc | 212 KB | — |
| Làm tròn 5 chữ số (~1,1 m) | 51 KB | 76% |
| + Douglas–Peucker tol 0,0001 (~11 m) | **13 KB** | **94%** |
| + Douglas–Peucker tol 0,0002 (~22 m) | 9 KB | 96% |

Chọn **tol = 0,0001 (~11 m) + làm tròn 5 chữ số**. Ở mức zoom tối đa của app (1:100.000, ~26 m/px) thì 11 m nằm dưới nửa pixel — mắt không phân biệt được.

Dự kiến: xã 157 MB → **~10 MB**, tỉnh ~13 MB → ~2 MB. Tổng nhẹ hơn GADM hiện tại (34,6 MB) đáng kể, đồng thời cập nhật và chính xác hơn.

Hàm đơn giản hóa phải **giữ nguyên topology cơ bản**: vòng khép kín vẫn khép, không sinh polygon rỗng. Test phải kiểm điều này.

### Thay đổi kéo theo

- Giữ nguyên id layer `layer_provinces_2026` / `layer_wards_2026` để không phá `layersState`, `LAYER_ATTRIBUTE_MAP` và test. Sau thay đổi này tên mới đúng với nội dung.
- Gỡ `gadm41_VNM_1.geojson` và `gadm41_VNM_3.geojson` khỏi `apps/web/public/`.
- `clip-to-vietnam.mjs` đang dùng GADM làm ranh giới — chuyển sang `provinces-34.geojson`.

### Hệ quả có chủ đích

Zoom vào Hà Nội hay Cần Thơ thấy ranh giới tỉnh nhưng **không có ranh giới xã**. Đây là kết quả của lựa chọn "34 tỉnh cả nước + xã trong 6 tỉnh", không phải lỗi.

## OSM waterways

### Kết quả khám phá dữ liệu

Khảo sát ô mẫu 1°×1° (108–109°E, 12–13°N, Đắk Lắk/Khánh Hòa) qua Overpass API:

**`waterway=*`:**

| Giá trị | Số lượng | Có tên |
|---|---|---|
| `stream` | 263 | 82 |
| `river` | 121 | 96 |
| `dam` | 37 | 16 |
| `canal` | 24 | 0 |
| `ditch` | 18 | 0 |
| `weir` | 3 | 0 |
| `waterfall` | 1 | 1 |

**Mặt nước (`natural=water` + `landuse=reservoir`):** 323 polygon

| Loại | Số lượng | Có tên |
|---|---|---|
| `water` (không rõ) | 199 | 3 |
| `reservoir` | 60 | 39 |
| `pond` | 37 | 0 |
| `lake` | 24 | 8 |
| `river` (polygon) | 3 | 1 |

**Đối chiếu dữ liệu hiện có trong cùng ô mẫu:** HydroLAKES có 83 hồ, **0 hồ có tên**. HydroRIVERS **không có tên sông nào**.

Ba phát hiện quyết định phạm vi:

1. **Tên riêng.** OSM có tên cho 96/121 sông và 50/323 hồ; dữ liệu hiện tại có 0. Với bản đồ tra cứu tài nguyên nước, tên là thứ người dùng cần nhất — thanh tìm kiếm hiện gần như vô dụng với sông/hồ.
2. **Độ phủ hồ gấp ~4×** (323 vs 83).
3. **`waterway=dam`** có hình học thân đập, khác với 371 điểm đập hiện có.

Phát hiện 1 và 2 mở rộng phạm vi từ "chỉ thay sông" sang "thay cả sông và hồ".

### Pipeline

```
fetch (rộng: waterway=* + natural=water + landuse=reservoir)
   → explore (thống kê tag/tên/độ phủ → báo cáo)
   → clip theo 6 tỉnh
   → seed
```

Bước tải phải **rộng hơn** danh sách tag dự kiến — nếu chỉ tải đúng ba tag đã chọn thì không phát hiện được gì mới.

`explore-osm.mjs` là script **giữ lại trong repo**, không phải việc dùng một lần: lần cập nhật sau còn kiểm tra được OSM đã thay đổi thế nào.

### Ánh xạ sông (`rivers`)

| `waterway` | `stream_order` | Nét | Ý nghĩa |
|---|---|---|---|
| `river` | 5 | Đậm | Sông chính |
| `canal` | 4 | Vừa | Kênh đào |
| `stream` | 2 | Mảnh | Suối |
| `ditch` | 1 | Rất mảnh | Mương thủy lợi |

`dam`, `weir`, `waterfall` **không** vào layer sông — chúng là công trình, không phải dòng chảy.

OSM không có bậc Strahler. Kiểm tra mức phụ thuộc: chỉ 4 chỗ dùng `streamOrder`, và `styles.ts` đã có mặc định `|| 6` nên không vỡ khi thiếu. Ánh xạ theo loại vào chính cột `stream_order` sẵn có → không đổi schema, không đổi `LAYER_ATTRIBUTE_MAP`.

**Thay đổi ngữ nghĩa cần nêu rõ:** popup hiện ghi "Cấp sông: Cấp N" theo nghĩa Strahler. Sau thay đổi, con số không còn nghĩa đó nên popup đổi sang nhãn loại ("Sông chính" / "Kênh đào" / "Suối" / "Mương").

Thêm cột `name` từ OSM.

### Ánh xạ hồ (`lakes`)

| OSM | `lake_type` |
|---|---|
| `landuse=reservoir` / `water=reservoir` | Hồ chứa |
| `water=lake` | Hồ tự nhiên |
| `water=pond` | Ao |
| `natural=water` (không rõ) | Mặt nước |

Cột `lake_type` đã có sẵn (từ HydroLAKES `Lake_type`), tái dùng được.

**Mất:** `Vol_total` (dung tích) và `Shore_len` (chiều dài bờ) — OSM không có. Hiện chưa chỗ nào dùng; nếu sau này cần thì phải lấy nguồn khác.
**Được:** tên (50 vs 0) và độ phủ gấp 4×.

### Báo cáo đối chiếu đập

371 điểm đập đến từ `apps/web/public/thuydienvietnam.geojson` — danh mục nội bộ của dự án, **không ghi nguồn gốc** ở bất kỳ đâu trong repo (khác với HydroSHEDS được ghi chép trong README). Cấu trúc cột (`English_hy` cắt cụt, `Quantity_(` lỗi ngoặc) cho thấy đây là bản xuất từ shapefile hoặc Excel.

Hai điểm cần biết:
- **Trạng thái đập là dữ liệu giả.** Cột `status` không có trong file gốc, được sinh bởi `assignDamStatus(p.ID)` — hash của ID chia theo tỷ lệ 70/18/12. "Bình thường / Xả lũ / Nguy hiểm" trên bản đồ không phản ánh thực tế nào. Code có ghi chú rõ, đây là dữ liệu mô phỏng giai đoạn phát triển.
- **19/371 đập không có toạ độ**, nằm trong DB với `geom = NULL`, bị lọc ở frontend.

Danh mục vẫn có giá trị thật ở các trường công suất/sản lượng/năm vận hành — OSM không có những trường này. Vì vậy **không trộn dữ liệu OSM vào layer đập**.

`report-dam-crosscheck.mjs` chỉ **sinh báo cáo Markdown**, không ghi DB:
- Đập OSM (`waterway=dam`) không khớp danh mục 371
- 19 đập thiếu toạ độ, kèm ứng viên OSM cùng tên nếu có

Người dùng rà tay và quyết định sau.

## Cắt dữ liệu chuyên đề

`clip-to-vietnam.mjs` tổng quát hóa thành **`clip-to-region.mjs`**: nhận danh sách mã tỉnh, dựng ranh giới vùng từ `provinces-34.geojson`, lọc mọi layer chuyên đề.

Thuật toán giữ nguyên — bbox loại nhanh rồi ray-casting, đã chạy tốt trên 26.863 đối tượng. Giữ quy tắc **"còn một đỉnh trong vùng thì giữ nguyên cả đối tượng"** để sông vắt ngang ranh giới không bị cắt cụt giữa dòng.

Áp cho cả 8 layer chuyên đề: `rivers`, `lakes`, `dams`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`. Năm layer cuối hiện chỉ có 2 bản ghi mẫu mỗi loại nên gần như không đổi, nhưng nguyên tắc phải nhất quán — dữ liệu thật thêm sau sẽ tự động được lọc.

## Xử lý dữ liệu cũ

Người dùng chọn **xóa hẳn** version HydroSHEDS thay vì giữ để rollback.

Giảm nhẹ rủi ro: xóa **dữ liệu trong DB**, nhưng **giữ file seed** `hydrorivers-vn.geojson` và `hydrolakes-vn.geojson` trong git. Nếu OSM tệ hơn dự kiến ở vùng nào đó, chạy lại ingest là dựng lại được.

`ingestRivers.ts` idempotent theo chuỗi `source`, nên chuỗi mới phải khác (`OSM waterways` thay vì `HydroRIVERS v10 vn-clip`), nếu không nó sẽ kích hoạt lại version cũ thay vì nạp dữ liệu mới.

## Kiểm thử

| Test | Bắt lỗi gì |
|---|---|
| `region.test.ts` | 6 mã tỉnh hợp lệ, khớp `provinces-34.geojson` |
| `clipToRegion.test.ts` | Điểm trong/ngoài vùng; đối tượng vắt ngang biên được giữ nguyên vẹn |
| `osmMapping.test.ts` | `waterway`→`stream_order`, `water`→`lake_type`, tag lạ không làm vỡ |
| `boundaries.test.ts` | 34 tỉnh đủ; xã chỉ thuộc 6 tỉnh; EPSG:4326 |
| `seed.test.ts` (sửa) | Đổi source string sang OSM |
| WFS integration (sửa) | 8 layer vẫn phục vụ; số lượng khớp DB |

Kiểm chứng thủ công sau khi seed: đếm WFS, và **chạy app chụp màn hình** để xác nhận bằng mắt.

## Thứ tự thực hiện

Sáu bước, mỗi bước chạy được và kiểm tra được:

1. `region.ts` + `fetch-boundaries.mjs` → ranh giới 34 tỉnh + xã 6 tỉnh
2. Frontend chuyển sang ranh giới mới, gỡ GADM
3. `fetch-osm-waterways.mjs` + `explore-osm.mjs` → dữ liệu thô + báo cáo khám phá
4. `clip-to-region.mjs` → cắt mọi layer chuyên đề
5. Seed OSM rivers/lakes, xóa version HydroSHEDS
6. `report-dam-crosscheck.mjs` → báo cáo đối chiếu đập

## Ngoài phạm vi

- **Không** sửa trạng thái đập giả (`assignDamStatus`) — vấn đề riêng, đáng một spec khác
- **Không** nhập hình học thân đập OSM — chỉ báo cáo
- **Không** đổi UI chọn vùng — vùng cố định trong code
- **Không** đụng basemap

## Rủi ro

**Overpass API không ổn định.** Trong lúc khám phá đã gặp lỗi timeout một lần, phải chuyển sang máy chủ dự phòng (`overpass.kumi.systems`). Script cần truy vấn theo từng tỉnh, tự thử lại và luân phiên endpoint. Kết quả commit vào git nên chỉ tải một lần; CI không phụ thuộc mạng.

**OSM là dữ liệu cộng đồng, độ phủ không đều.** Sông chính rất tốt; suối nhỏ vùng sâu có thể thiếu chỗ này chỗ kia. Ngược lại HydroRIVERS phủ đều nhưng sai vị trí. Đây là đánh đổi *chính xác vị trí* lấy *đồng đều độ phủ* — với bản đồ chuyên đề thì vị trí đúng quan trọng hơn.

**Giấy phép ODbL.** Cả sông và hồ giờ là OSM, cần ghi công "© OpenStreetMap contributors" ở chú giải. Hiện attribution chỉ có ở basemap.

## Tiêu chí hoàn thành

1. Bản đồ hiển thị ranh giới 34 tỉnh sau sáp nhập, tên đúng tên mới.
2. Ranh giới xã hiển thị trong 6 tỉnh của vùng.
3. Không có đối tượng chuyên đề nào nằm ngoài 6 tỉnh — trong DB, trong WFS, trên bản đồ.
4. Sông bám đúng lòng sông thật, không còn hình bậc thang.
5. Sông và hồ hiển thị tên khi bấm vào.
6. Báo cáo đối chiếu đập được sinh ra và đọc được.
7. Toàn bộ test pass; build sạch.
