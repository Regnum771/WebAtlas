#!/usr/bin/env bash
#
# Cập nhật bản đang chạy trên máy chủ lên commit mới nhất của main.
#
# Chạy trên CHÍNH máy chủ. GitHub Actions gọi nó qua self-hosted runner (xem
# .github/workflows/ci.yml), nhưng nó cũng là lệnh để chạy tay khi cần triển khai mà
# không qua CI — cùng một đường, nên không có chuyện "trên CI thì lại khác".
#
# Nó KHÔNG nạp dữ liệu. Xem phần "Vì sao không seed" ở cuối file.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/webatlas}"

# bash đọc script theo từng đoạn TRONG LÚC chạy, không nạp hết vào bộ nhớ trước. Mà bước
# đầu tiên dưới đây là `git reset --hard`, tức là ghi đè đúng cái file đang chạy — phần
# chưa đọc tới sẽ lệch đi và bash thực thi nhầm giữa dòng. Nên: nhân bản ra /tmp, chạy
# tiếp ở đó, rồi mới đụng vào git.
if [ "${DEPLOY_REEXEC:-}" != "1" ]; then
  _copy="$(mktemp /tmp/webatlas-deploy.XXXXXX.sh)"
  cat "$0" > "$_copy"
  chmod +x "$_copy"
  DEPLOY_REEXEC=1 exec "$_copy" "$@"
fi
# Gỡ tên khỏi thư mục ngay: Linux giữ file sống chừng nào bash còn mở fd của nó, nên
# script vẫn chạy trọn vẹn mà /tmp không đọng rác sau mỗi lần triển khai.
rm -f "$0"

cd "$REPO_DIR"

COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

log "Lấy mã nguồn mới"
git fetch --prune origin
# reset --hard chứ không phải pull: máy chủ không được phép có commit riêng, và một
# merge conflict giữa lúc triển khai là tình huống không ai muốn gỡ qua SSH.
git reset --hard origin/main
git --no-pager log -1 --format='%h %s'

log "Cài phụ thuộc"
# ci chứ không phải install: bám đúng lockfile, và xoá sạch node_modules cũ nên một
# phụ thuộc vừa bị gỡ khỏi package.json không còn sót lại trên đĩa.
npm ci

log "Build @webatlas/shared"
# Cả API lẫn web đều nhập gói này qua `dist/`. Phải đi trước cả hai.
npm run build:shared

log "Chạy migration"
# Trước khi khởi động lại API, không phải sau: API mới có thể trông đợi cột mà migration
# tạo ra. Thứ tự ngược lại là API mới chạy trên schema cũ.
#
# `set -e` khiến script dừng ngay nếu bước này hỏng, và đó là chủ đích — thà giữ nguyên
# bản cũ đang chạy tốt còn hơn khởi động lại API trên một schema nửa vời.
npm run migrate:up -w @webatlas/api

log "Build web"
# Truyền biến thẳng vào môi trường build thay vì dựa vào apps/web/.env.production:
# Vite đọc VITE_* từ process env, nên không có file nào phải tồn tại sẵn trên máy chủ
# và không có gì để lệch giữa hai lần triển khai.
#
# Đường dẫn tương đối, không phải URL tuyệt đối — Caddy gộp cả ba về cùng một origin.
VITE_API_BASE_URL=/api \
VITE_GEOSERVER_URL=/geoserver \
  npm run build:web
# Caddy mount apps/web/dist dạng chỉ-đọc nên bản mới có hiệu lực ngay, không cần
# khởi động lại container nào.

log "Dựng lại container"
# up -d --build cho TẤT CẢ service, không riêng api: compose chỉ tạo lại thứ đã đổi, nên
# một thay đổi trong docker-compose.prod.yml hay Caddyfile cũng được áp dụng theo.
$COMPOSE up -d --build

log "Publish lại lớp lên GeoServer"
# An toàn khi chạy lại: publish.ts dùng PUT để trỏ lại featuretype đã có thay vì xoá rồi
# tạo lại, nên style và cấu hình của lớp được giữ nguyên.
npm run publish:geoserver -w @webatlas/api

log "Kiểm chứng"
# Gọi qua địa chỉ công khai thật, không phải 127.0.0.1: Caddy chỉ phục vụ site block
# khớp với SITE_ADDRESS, nên một request tới 127.0.0.1 mang Host sai sẽ rơi vào 404 và
# báo hỏng giả. Đi đúng đường trình duyệt đi thì kiểm luôn được cả TLS lẫn proxy.
#
# Đọc riêng một dòng thay vì `source` cả file: .env.prod chứa mật khẩu, không có lý do
# gì nạp hết chúng vào môi trường của script này.
SITE_URL=$(grep -E '^SITE_URL=' infra/.env.prod | cut -d= -f2- | tr -d '"'"'"' \r')
if [ -z "$SITE_URL" ]; then
  echo "  bỏ qua: infra/.env.prod không có SITE_URL"
  exit 0
fi

fail=0
check() {
  local desc="$1" expected="$2" url="$3" code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo 000)
  if [ "$code" = "$expected" ]; then
    printf '  ok    %s (%s)\n' "$desc" "$code"
  else
    printf '  FAIL  %s (%s, mong đợi %s)\n' "$desc" "$code" "$expected"
    fail=1
  fi
}

check "web tĩnh"                200 "$SITE_URL/"
check "API qua proxy"           200 "$SITE_URL/api/layers"
check "admin GeoServer bị chặn" 404 "$SITE_URL/geoserver/web"

if [ "$fail" -ne 0 ]; then
  log "Triển khai xong nhưng KIỂM CHỨNG KHÔNG ĐẠT"
  $COMPOSE ps
  exit 1
fi

log "Triển khai xong"

# --- Vì sao không seed -------------------------------------------------------------
#
# `npm run seed` KHÔNG được nằm trong đường triển khai tự động, dù nó là bước 3 của
# docs/runbooks/README.md.
#
# Lý do nằm trong chính runSeeds(): mỗi lần chạy, nó tạo một dataset version MỚI cho từng
# lớp rồi activate version đó. Nó không ghi đè — nó thay thế. Bản biên tập của người quản
# lý dữ liệu vẫn còn nguyên trong version cũ, nhưng version cũ thôi không còn active, nên
# trên bản đồ thì công của họ biến mất. Đặt nó vào pipeline là đều đặn xoá sổ mọi chỉnh
# sửa mà đội ngũ vừa làm, mỗi lần có người push.
#
# Nạp seed là việc có chủ đích, làm tay, và biết trước là đang thay dữ liệu:
#   npm run seed -w @webatlas/api
#
# Cùng lý do đó, các bước nặng và một-lần cũng không ở đây: basemap (bước 5), DEM
# (bước 6) và contours (bước 7). Xem docs/runbooks/README.md.
