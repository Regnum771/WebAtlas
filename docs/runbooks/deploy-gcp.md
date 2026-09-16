# Runbook — triển khai trên Google Compute Engine

**Chạy khi:** cần đưa demo lên một địa chỉ công khai chạy 24/7.

Đích đến là **một** máy ảo x86_64 trên Google Compute Engine, trả bằng credit 300 USD của
bản dùng thử GCP. Cả stack chạy trên đó: PostGIS, GeoServer, API và web tĩnh sau một
reverse proxy có TLS.

> ## Đọc trước: đây là miễn phí CÓ HẠN, không phải miễn phí vĩnh viễn
>
> Credit dùng thử là **300 USD hoặc 90 ngày, hết cái nào trước thì dừng cái đó**. Sau đó
> máy ảo **tắt** nếu không nâng lên tài khoản trả phí. Đây không phải chi tiết nhỏ — nó là
> hạn sử dụng của cả bản triển khai này, và phải có kế hoạch trước khi tới ngày thứ 90.
>
> Gói Always Free của GCP (e2-micro, 1 GB RAM) **không** gánh nổi stack này: GeoServer
> render metatile 1024×1024 với hơn 100 nghìn đường đồng mức sẽ thrash trong 1 GB.
>
> Số liệu giá và điều khoản dùng thử bên dưới thay đổi theo thời gian — kiểm tra lại trên
> trang của Google trước khi tin vào phép tính.

## Vì sao là một VM chứ không phải PaaS miễn phí

Ba yêu cầu cứng, và không gói PaaS miễn phí nào đáp ứng đủ cả ba:

- **~2 GB RAM.** GeoServer là ứng dụng Java.
- **~2 GB đĩa bền.** `basemap.dem_region` một mình đã **426 MB**
  ([elevation-dem.md](elevation-dem.md)); cộng contours và các lớp `water.*` thì DB vào
  khoảng 600–700 MB. Mọi gói Postgres miễn phí đều dừng ở 0.5 GB.
- **Chạy liên tục.** Các gói free đều ngủ khi rảnh.

Và GeoServer không bỏ được: basemap là **5 layer group** riêng, mỗi cái một tile cache và
style SLD, còn [`basemapInfo.ts`](../../apps/web/src/features/map/model/basemapInfo.ts)
dùng **WMS GetFeatureInfo** — truy vấn tương tác, không chỉ lấy ảnh tile. Thay nó bằng
tile tĩnh là viết lại phần truy vấn đó phía client, không phải đổi cấu hình.

## Giới hạn cần biết trước

- **Cần thẻ tín dụng để xác minh.** Không bị trừ tiền trong thời gian dùng thử, nhưng
  không mở được tài khoản nếu thiếu.
- **Egress có tính phí** (~0,12 USD/GB sau phần miễn phí ít ỏi mỗi tháng). Với vài người
  xem thì không đáng kể; nhưng nếu demo được chia sẻ rộng, đây là dòng chi phí bất ngờ.
  Bản đồ phục vụ tile, mà tile thì nhiều.
- **FABDEM là CC BY-NC-SA 4.0 — phi thương mại** (xem `basemap.dataset_sources`). Demo
  công khai thì hợp lệ; thương mại thì không.
- **Trợ lý bản đồ có tính phí riêng.** Bỏ trống `ANTHROPIC_API_KEY` thì route trả 503 và
  mọi phần còn lại chạy bình thường.

## 1. Tạo máy ảo

**e2-medium** (2 vCPU, 4 GB), Ubuntu LTS, đĩa **50 GB**, region Mỹ (rẻ nhất).

Vì sao 50 GB: OSM extract 684 MB + DEM thô 512 MB + GeoTIFF đã cắt 285 MB + DB ~1 GB +
ảnh Docker ~3 GB + `node_modules`. 50 GB là thoải mái, không phải dư thừa.

Phép tính để thấy credit đủ:

| Khoản | Ước tính/tháng |
|---|---|
| e2-medium | ~25 USD |
| Đĩa 50 GB | ~2–5 USD |
| IP tĩnh (đã gắn vào máy) | miễn phí |
| **Tổng** | **~30 USD** |

90 ngày ≈ 90 USD trên 300 USD credit. Dư nhiều — nếu GeoServer chật, nâng lên
**e2-standard-2** (8 GB, ~49 USD/tháng ≈ 150 USD cho 90 ngày) vẫn nằm trong credit.

**Đặt budget alert ngay khi tạo xong**, ở mức 50% và 90% của 300 USD. Credit hết mà không
biết thì máy tắt giữa lúc đang cần demo.

### IP tĩnh — làm ngay, đừng để sau

IP ngoài của GCE mặc định là **ephemeral**: dừng máy rồi bật lại là đổi IP, và chứng chỉ
TLS cùng DNS gãy theo. Vào **VPC network → IP addresses**, đổi IP của máy sang **Static**.
IP tĩnh đang gắn vào máy chạy thì không mất phí; IP tĩnh **không gắn vào đâu** thì có.

### Tường lửa

GCP chỉ có **một** lớp (khác Oracle): VPC firewall. Không có luật iptables cục bộ nào phải
gỡ trên ảnh Ubuntu của Google.

Gắn network tag `http-server` và `https-server` cho máy — hai luật `default-allow-http` và
`default-allow-https` có sẵn trong VPC mặc định sẽ ăn theo tag đó. Cổng 22 để nguyên mặc
định; pipeline **không** dùng SSH (xem mục 7).

## 2. Cài công cụ

Node cần cho các bước nạp dữ liệu và build web — chúng chạy trên máy chủ chứ không trong
container:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # đăng xuất/đăng nhập lại cho có hiệu lực
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

## 3. Lấy mã nguồn và cấu hình

```bash
git clone <repo> webatlas && cd webatlas
npm ci

cp infra/.env.prod.example infra/.env.prod
cp apps/api/.env.example apps/api/.env
```

Điền [`infra/.env.prod`](../../infra/.env.prod.example). Mật khẩu sinh bằng
`openssl rand -base64 24`, đừng bịa tay.

`SITE_ADDRESS` quyết định TLS:

| Tình huống | Đặt `SITE_ADDRESS` | Kết quả |
|---|---|---|
| Có tên miền | `atlas.example.com` | Caddy tự xin và tự gia hạn chứng chỉ Let's Encrypt |
| Không có tên miền | `34-70-1-2.nip.io` (IP tĩnh, chấm đổi thành gạch) | Vẫn ra HTTPS thật — nip.io phân giải về đúng IP đó |
| Chỉ thử nhanh | `:80` | HTTP trần, không TLS |

**`apps/api/.env` phải khớp `infra/.env.prod`** — cùng mật khẩu, và giữ `localhost` trong
`DATABASE_URL`/`GEOSERVER_URL`. File này phục vụ các lệnh `npm` chạy trên máy chủ ở bước
4–5, nối vào container qua cổng loopback. Container API không đọc nó; nó nhận biến trực
tiếp từ compose, ở đó host là `db` và `geoserver`.

## 4. Dựng stack

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

Chỉ ảnh API là build; `db`, `geoserver`, `caddy` đều kéo ảnh dựng sẵn. Kiểm tra cả bốn
service `running` trước khi đi tiếp:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod ps
```

### Khác gì so với `infra/docker-compose.yml` của bản dev

Ảnh thì **giống hệt** — cùng `postgis/postgis:16-3.4`, cùng
`docker.osgeo.org/geoserver:2.26.0`. Khác ở bốn điểm:

1. Thêm service `api` và `caddy`.
2. `db` và `geoserver` bind vào `127.0.0.1`, không phải mọi giao diện mạng.
3. `CORS_ENABLED=false` trên GeoServer — sau Caddy thì mọi thứ chung một origin.
4. Là file **độc lập**, không phải override: danh sách `ports` trong compose *cộng dồn*
   khi ghép file, nên một override không thể gỡ phần bind `0.0.0.0` của bản dev. Trên máy
   có IP công khai thì đó là Postgres mở toang.

## 5. Nạp dữ liệu

Chạy **nguyên xi các bước 2–8 trong [README.md](README.md)** — không lệnh nào khác đi. Cổng
loopback ở bước 4 tồn tại chính là để những lệnh này chạy được.

Bước 5 (basemap) và bước 6 (DEM) tải về khoảng 1,4 GB và tốn kha khá thời gian; chạy trong
`tmux` để mất SSH không mất luôn công.

## 6. Build web và kiểm chứng

```bash
VITE_API_BASE_URL=/api \
VITE_GEOSERVER_URL=/geoserver \
  npm run build:web
```

Truyền thẳng vào môi trường build chứ **không** tạo `apps/web/.env.production`: Vite đọc
`VITE_*` từ process env, nên không file nào phải tồn tại sẵn và không có gì lệch giữa hai
lần triển khai. [`infra/deploy.sh`](../../infra/deploy.sh) chạy đúng lệnh này.

Caddy mount `apps/web/dist` chỉ-đọc nên build xong là trang đổi ngay.

Đừng tin là xong khi mới thấy trang hiện ra:

```bash
SITE=https://atlas.example.com

curl -sI "$SITE/" | head -1                                    # 200 — web tĩnh
curl -s  "$SITE/api/layers" | head -c 200                      # JSON — API qua proxy
curl -sI "$SITE/geoserver/webatlas/wms?service=WMS&request=GetCapabilities" | head -1
curl -sI "$SITE/geoserver/web" | head -1                       # 404 — admin đã bị chặn
```

Lệnh cuối **phải** ra 404. Ra 200 nghĩa là trang quản trị GeoServer đang nằm trần trên
Internet — dừng lại và xem [`infra/Caddyfile`](../../infra/Caddyfile).

Rồi mở trang thật, bật lớp đường đồng mức và kéo bản đồ. Tile phải về, console không có
lỗi CORS hay mixed-content.

## 7. CI/CD — tự động triển khai khi push vào main

> **Repo phải là PRIVATE trước bước này.** Self-hosted runner chạy mã của workflow ngay
> trên máy chủ production. Với repo công khai, bất kỳ ai cũng fork được rồi mở pull
> request — đó là mã của người lạ chạy trên máy của bạn. Điều kiện tiên quyết, không phải
> khuyến nghị.

Sau khi cài, mỗi lần push vào `main`: ba job test chạy trên runner của GitHub, và **chỉ khi
cả ba xanh** thì job `deploy` mới chạy trên VM.

### Vì sao test không chạy trên runner của máy chủ

Job `api` trong [`ci.yml`](../../.github/workflows/ci.yml) dựng service Postgres map ra
`5432:5432` và trỏ `DATABASE_URL` vào `localhost:5432`. Trên VM production cổng đó đã là
Postgres thật. Job sẽ hoặc hỏng, hoặc — tệ hơn nhiều — nối thẳng vào **DB production** rồi
chạy `npm run seed` lên đó. Test ở lại runner của GitHub; runner của máy chủ chỉ nhận mỗi
job `deploy`.

### Cài runner

**Settings → Actions → Runners → New self-hosted runner**, chọn **Linux / x64** (máy GCP là
x86_64). Trang đó in ra lệnh tải kèm phiên bản hiện hành và token đăng ký — dùng đúng lệnh
ở đó, token chỉ sống khoảng một giờ.

Tới bước `./config.sh`, thêm nhãn mà workflow đang chờ:

```bash
./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN> \
            --labels webatlas-deploy --unattended
```

Rồi cài thành dịch vụ để sống qua reboot:

```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

**Chạy runner bằng đúng user sở hữu `~/webatlas` và có trong nhóm `docker`.** Cài bằng
`root` hay user khác thì `deploy.sh` không đọc được thư mục làm việc, không gọi được
`docker`, và hỏng ngay lần đầu.

### Pipeline làm gì

[`infra/deploy.sh`](../../infra/deploy.sh), đúng thứ tự:

| # | Việc | Vì sao ở vị trí đó |
|---|---|---|
| 1 | `git reset --hard origin/main` | Không `pull`: máy chủ không được có commit riêng, và conflict giữa lúc triển khai là thứ không ai muốn gỡ qua SSH |
| 2 | `npm ci` | Bám lockfile, dọn luôn phụ thuộc vừa bị gỡ |
| 3 | `npm run build:shared` | Cả API lẫn web đều nhập gói này qua `dist/` |
| 4 | `npm run migrate:up` | **Trước** khi khởi động lại API — API mới có thể cần cột mà migration vừa tạo |
| 5 | `npm run build:web` | Caddy mount `dist` chỉ-đọc nên có hiệu lực ngay |
| 6 | `docker compose up -d --build` | Cho mọi service: compose chỉ tạo lại thứ đã đổi, nên sửa Caddyfile cũng được áp dụng |
| 7 | `npm run publish:geoserver` | An toàn khi lặp: `publish.ts` dùng `PUT` nên giữ nguyên style của lớp |
| 8 | 3 lần `curl` qua địa chỉ công khai | Kiểm luôn TLS và proxy, không chỉ kiểm ứng dụng còn sống |

Hỏng ở bất kỳ bước nào là dừng ngay (`set -euo pipefail`) và job đỏ. Đặc biệt bước 4: thà
giữ nguyên bản cũ đang chạy tốt còn hơn khởi động lại API trên một schema nửa vời.

Hai lần triển khai không chồng nhau — `concurrency: deploy-production` với
`cancel-in-progress: false`, vì cắt ngang một lần `migrate` còn tệ hơn xếp hàng đợi.

### Pipeline cố ý KHÔNG làm gì

**Không chạy `npm run seed`.** Đây là điều quan trọng nhất trong cả mục này.

[`runSeeds()`](../../apps/api/src/db/seeds/run.ts) không ghi đè dữ liệu — mỗi lần chạy nó
tạo một dataset version **mới** cho từng lớp rồi activate version đó. Bản biên tập của
người quản lý dữ liệu vẫn còn nguyên trong version cũ, nhưng version cũ thôi không còn
active, nên trên bản đồ thì công của họ biến mất. Để seed vào pipeline là đều đặn xoá sổ
mọi chỉnh sửa của đội, mỗi lần có người push.

Nạp seed là việc làm tay, có chủ đích: `npm run seed -w @webatlas/api`.

Cùng lý do, các bước nặng và một-lần cũng nằm ngoài: basemap (bước 5), DEM (bước 6),
contours (bước 7).

### Triển khai tay

Cùng một đường, không có nhánh riêng cho CI:

```bash
bash ~/webatlas/infra/deploy.sh
```

## Khi credit sắp hết

Đặt lời nhắc ở **ngày thứ 75**, không phải ngày 89. Ba lựa chọn:

1. **Nâng lên tài khoản trả phí** — khoảng 30 USD/tháng, không phải đụng gì vào cấu hình.
2. **Chuyển sang VPS rẻ** (~4–6 USD/tháng). Cũng là x86 nên bộ cấu hình này chạy y nguyên,
   không sửa một dòng nào.
3. **Chuyển sang Oracle Always Free** nếu lúc đó đăng ký được — miễn phí vĩnh viễn, nhưng
   là máy ARM. Xem phụ lục.

Dù chọn gì, **sao lưu DB trước**: `docker compose ... exec db pg_dump -U webatlas webatlas
| gzip > backup.sql.gz`. Dựng lại DEM và basemap từ đầu tốn hàng giờ; khôi phục từ dump
tốn vài phút.

## Phụ lục — nếu chuyển sang máy ARM

Đã kiểm chứng bằng `docker manifest inspect`, giữ lại ở đây vì nó không hiển nhiên chút nào:

| Ảnh đang dùng | Kiến trúc | Thay bằng gì trên ARM |
|---|---|---|
| `postgis/postgis:16-3.4` | **chỉ amd64** | `imresamu/postgis:16-3.4` — cùng phiên bản, có arm64, cùng người bảo trì bộ ảnh chính thức |
| `docker.osgeo.org/geoserver:2.26.0` | **chỉ amd64** | build từ [geoserver/docker](https://github.com/geoserver/docker) nhánh `gs-2.25.3` với `--build-arg GS_VERSION=2.26.0` |

Nhánh `gs-2.25.3` nhận `GS_VERSION` qua ARG và tải WAR tương ứng, nên dựng ra đúng 2.26.0;
ảnh nền `tomcat:9.0.95-jdk11-temurin-jammy` mà nó ghim theo digest là một OCI image index
có arm64. Build nhanh — nhánh đó chỉ một stage, không biên dịch GDAL/PROJ từ nguồn.

> **Không dùng nhánh `master`.** Master đã sang GeoServer 3.0 trên Tomcat 11
> (`jakarta.servlet`). GeoServer 2.26 vẫn là `javax.servlet`, không deploy nổi trên đó.
> Repo cũng **không có tag nào** — `gs-2.25.3` là nhánh phát hành gần 2.26 nhất.

Rủi ro ARM thứ ba đã kiểm tra và không thành vấn đề: `@node-rs/argon2` (native, hash mật
khẩu) có sẵn `@node-rs/argon2-linux-arm64-gnu` trong `package-lock.json`.

Và khi cài self-hosted runner trên máy ARM, chọn **Linux / ARM64** thay vì x64.

## Bẫy đã gặp

- **`handle_path` cho `/api`, `handle` cho `/geoserver`.** API đăng ký route ở gốc
  (`/layers`, `/auth/...`) nên tiền tố `/api` phải bị cắt. GeoServer ngược lại: nó tự phục
  vụ dưới `/geoserver` và sinh URL nội bộ theo tiền tố đó, cắt đi là gãy WMTS
  GetCapabilities.
- **Chặn admin phải là `handle` bọc `respond`, không được viết `respond @matcher` trần.**
  Các khối `handle` loại trừ nhau và xét theo thứ tự trong file, còn `respond` trần nằm ở
  nhóm directive khác và bị Caddy xếp *sau* `handle` — tới lúc đó `/geoserver/*` đã proxy
  đi mất. Kiểm chứng bằng `caddy adapt` và đọc thứ tự route, đừng đoán.
- **IP ephemeral của GCE đổi sau mỗi lần stop/start.** Chứng chỉ TLS và DNS gãy theo, mà
  triệu chứng thì trông như lỗi Caddy. Đổi sang static ngay từ đầu.
- **Nguồn của `packages/shared` phải vào ảnh trước `npm ci`.** Script `prepare` của nó chạy
  `tsc` ngay trong lúc cài; thiếu `src/` thì tsc thoát với TS18003 và cả bước cài đổ theo.
- **Đừng đặt `NODE_ENV=production` trước `npm ci`.** `tsx` — thứ chạy máy chủ API — là
  devDependency, `typescript` cũng vậy. Đặt sớm là cài thiếu và container không khởi động nổi.
- **`deploy.sh` tự ghi đè chính nó** ở bước `git reset --hard`: bash đọc script theo từng
  đoạn trong lúc chạy. Script đã tự xử lý bằng cách nhân bản ra `/tmp` rồi `exec` sang bản
  sao — đừng gỡ đoạn đó ra.
