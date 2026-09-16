# syntax=docker/dockerfile:1

# Ảnh API cho máy ARM (Oracle Always Free). Chạy qua tsx đúng như `npm start` trên máy
# dev: apps/api không có bước build, chỉ @webatlas/shared có — API nhập nó qua `dist/`.
#
# Vì sao node:22 mà không phải mới hơn: package.json gốc ghi `"node": ">=22 <23"`.
FROM node:22-bookworm-slim

WORKDIR /app

# Nguồn của @webatlas/shared phải nằm sẵn TRƯỚC `npm ci`, không phải sau. Script
# `prepare` của nó chạy `tsc` ngay trong lúc cài; nếu thư mục src chưa có, tsc thoát
# với TS18003 (no inputs found) và cả bước cài đổ theo.
COPY package.json package-lock.json ./
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
# Chỉ lấy manifest của web: npm workspaces đọc mọi thành viên khai báo trong `workspaces`
# lúc cài, nên thiếu file này `npm ci` sẽ than lockfile không khớp. Nguồn của web không
# cần vào ảnh này — Caddy phục vụ bản dist đã build sẵn.
COPY apps/web/package.json apps/web/

# Không đặt NODE_ENV=production ở đây: tsx là devDependency của @webatlas/api và là thứ
# chạy máy chủ, còn typescript là devDependency mà `prepare` của shared cần. Cài kèm
# devDependencies là bắt buộc, không phải sơ suất.
RUN npm ci

# Đặt sau khi cài, nên nó chỉ tác động lúc chạy (Fastify tắt log pretty, v.v.)
ENV NODE_ENV=production

EXPOSE 3001

CMD ["npm", "run", "start", "-w", "@webatlas/api"]
