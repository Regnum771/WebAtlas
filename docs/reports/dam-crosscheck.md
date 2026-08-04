# Báo cáo đối chiếu đập: OSM vs danh mục dự án

*Sinh tự động bởi `apps/api/scripts/report-dam-crosscheck.mjs` — 2026-08-04*

**Báo cáo này không sửa dữ liệu.** Danh mục dự án có các trường ISO (công suất,
sản lượng, năm vận hành) mà OSM không có, nên mọi thay đổi phải do người rà soát quyết định.

## Tổng quan

- Danh mục dự án: **371** đập (trong đó **19** thiếu toạ độ)
- OSM `waterway=dam` trong vùng: **451** (trong đó **161** có tên)
- Đập OSM có tên nhưng không khớp danh mục: **91**

## 1. Đập OSM không khớp danh mục

Có thể là đập nhỏ/thuỷ lợi (không thuộc phạm vi danh mục thuỷ điện), hoặc là thiếu sót của danh mục.

| Tên OSM | osmId |
|---|---|
| ເຂື່ອນໄຟຟ້າເຊຂະໝານ 3 | `319154075` |
| Đập thủy điện Sông Côn 2 | `390411207` |
| Đập Ba La | `424120079` |
| Đập Khe Tân | `431510118` |
| Đập thủy điện Sông Côn 1 | `434818472` |
| Đập Khe Ngang | `656517678` |
| Đập Thảo Long | `656537384` |
| Đập La Ỷ | `895487107` |
| Đập dâng Trà Khúc | `1227192937` |
| Đập Dâng Văn Phong | `233480579` |
| Đập Đồng Mít | `338966831` |
| Đập thủy điện Ka Nak | `485557418` |
| Đập thủy điện An Khê | `616800333` |
| Đập Đăk Uy | `740014671` |
| Đập tràn | `817456191` |
| Đập thủy lợi Biển Hồ | `826019902` |
| Đập Hố Xoài | `1151897290` |
| Dak Lay | `1320783725` |
| Đập Phú Xuân | `193647609` |
| Đập Núi Một | `233208104` |
| Đập Mỹ Thuận | `252084750` |
| Đập Ea Súp Thượng | `480654331` |
| Đập Ea Súp Hạ | `480654367` |
| Đập Ia Jlơi | `480658128` |
| Đập Hà Yến | `544336068` |
| Đập Ia Mlah | `805164907` |
| Đập thủy lợi Ea H'leo 1 | `954625783` |
| Đập Tân Thắng | `1151213819` |
| Đập Chánh Hùng | `1151213820` |
| Đập Đồng Tròn | `1225366432` |
| Đập thủy điện Đăk Srông 1 | `1320783950` |
| Đập Ea Drăng | `1365853906` |
| Đập dâng Phú Phong | `1392345114` |
| Đập dâng Ia Pết (Công trường Ia Pết) | `1396274725` |
| Đập Đá Bàn | `1545968694` |
| Đập Suối Tre | `1546876377` |
| Đập Tường Sơn | `1546894108` |
| Đập Ea Rớt | `843829039` |
| Đập Lòng Sông | `925999759` |
| Đập Krông Pách Thượng | `1046419575` |
| Đập Hoa Sơn | `1151172435` |
| Đập Đá Bàn | `1168469072` |
| Đập Krông Búk Hạ | `803137459` |
| Đập thủy điện Srêpốk 3 | `983091458` |
| Đập thủy điện Srêpốk 4 | `983091461` |
| Đập Buôn Joong | `1300457164` |
| Đập thủy điện Yantiansien | `1320783742` |
| Đập Sông Ray | `129954287` |
| Đập Sông Quao | `254573473` |
| Cửa xả Bậc Trên | `481308769` |
| Đập thủy điện Hàm Thuận | `481411200` |
| Đập Sông Khán | `486619747` |
| Đập Bàu Úc | `744468296` |
| Đập 1 | `851853888` |
| Đập thủy điện Ankroet | `1153393257` |
| Đập thủy lợi Đạ Tẻh | `1204352111` |
| Cửa nhận nước Đồng Nai 4 | `1205505959` |
| Đập thủy điện Đăk Mê | `1207107061` |
| Đập Thuỷ điện Đa Queyon | `1207148497` |
| Đập thủy điện Đa Quyn | `1207148498` |
| Đập Vàm Hô | `1215089873` |
| Đập thủy điện Đại Bình | `1229075436` |
| Đập tràn Thuỷ điện Bảo Lộc | `1229075438` |
| Đập thủy điện Đăk R'Tíh 2 | `1229806943` |
| Đập thuỷ lợi Phước Lộc | `1230281243` |
| Đập tràn Thủy điện Dambri 1 | `1241351993` |
| Đập Thuỷ điện Đạ Dâng 3 | `1245291758` |
| Đập Srê Kơ Lào | `1253580689` |
| Đập Ka La | `1253580697` |
| Đập Tây Di Linh | `1253580699` |
| Đập Đông Di Linh | `1253580701` |
| Đập Rẫy Mới | `1277977211` |
| Đập Hố Bom | `1277977213` |
| Đập Hồ Cai Bảng | `1344494166` |
| Đập Bê Đê | `1373674503` |
| Đập Minh Rồng | `1392730433` |
| Đập tràn Bằng Lăng | `1421089665` |
| Đập Mai Thành | `1533888239` |
| Đập Lòng Sông | `1545643012` |
| Đập Đá Bạc | `1545643013` |
| Đập Tân Giang | `1545902306` |
| Đập CK7 | `1545902315` |
| Đập CK7 | `1545902316` |
| Đập Tà Ranh | `1545902323` |
| Đập Suối Đá | `1546195317` |
| Đập Suối Đá | `1546195318` |
| Đập Hàm Thuận | `1546228793` |
| Đập Sông Quao | `1546228808` |
| Cống điều tiết kênh muối | `1546477497` |
| Cống điều tiết kênh muối | `1546477503` |
| Cống điều tiết kênh muối | `1546477515` |

## 2. Đập thiếu toạ độ trong danh mục

Các đập này nằm trong DB với `geom = NULL` và không hiện trên bản đồ.
Cột cuối là ứng viên OSM khớp tên — **cần kiểm tra thủ công trước khi dùng**.

| ID | Tên | Ứng viên OSM |
|---|---|---|
| 64 | Sông Lô 5 | — |
| 84 | Bảo Lâm 3A | — |
| 118 | Tà Lơi 1 | — |
| 143 | Nậm Chim 1A | — |
| 144 | Nậm Chim 1B | — |
| 150 | Đông Pao | — |
| 151 | Chu Va 2 | — |
| 187 | Nậm Sì Lường 3 | — |
| 188 | Nậm Sì Lường 4 | — |
| 216 | Tam Thanh | — |
| 217 | Sơn Lư | — |
| 277 | Đăk Ble | — |
| 280 | Krông Pa 2 | — |
| 303 | Đăk Psi | — |
| 308 | Đăk Psi 6 | `1318145188` (Đập thủy điện Đăk Psi 6) |
| 311 | Đăk Ruồi | — |
| 312 | Đăk Ruồi 2 | — |
| 313 | Ry Ninh 2 | — |
| 336 | Trà Khúc 2 | — |
