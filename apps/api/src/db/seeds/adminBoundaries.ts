import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/db/seeds -> repo root is five levels up (same derivation as registry.ts)
const repoRoot = resolve(here, '../../../../..');
const webPublic = resolve(repoRoot, 'apps/web/public');

/**
 * Nạp từ chính hai tệp trình duyệt đang dùng, đã commit trong repo: một bản sao mới clone
 * chạy được mà không cần mạng. Hệ quả đã biết: hình học giản lược ~11 m (xem migration
 * 1000000000015) nên đối tượng sát ranh giới có thể bị gán sang đơn vị kế bên.
 */
export const PROVINCES_FILE = resolve(webPublic, 'provinces-34.geojson');
export const WARDS_FILE = resolve(webPublic, 'wards-region.geojson');

interface Feature {
  geometry: unknown;
  properties: Record<string, unknown>;
}

function featuresOf(file: string): Feature[] {
  const fc = JSON.parse(readFileSync(file, 'utf8')) as { features: Feature[] };
  return fc.features;
}

/**
 * Thay toàn bộ nội dung hai bảng trong giao dịch của người gọi. Thay vì UPSERT: ranh giới
 * là một tập đóng — một đơn vị bị bỏ khỏi nguồn phải biến mất, chứ không nằm lại mãi mãi.
 * Xoá xã trước tỉnh vì khoá ngoại là ON DELETE RESTRICT.
 */
export async function loadAdminBoundaries(
  client: pg.PoolClient
): Promise<{ provinces: number; wards: number }> {
  await client.query('DELETE FROM admin.wards');
  await client.query('DELETE FROM admin.provinces');

  const provinces = featuresOf(PROVINCES_FILE);
  for (const f of provinces) {
    await client.query(
      `INSERT INTO admin.provinces (code, name, name_en, full_name, area_km2, geom)
       VALUES ($1, $2, $3, $4, $5, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)))`,
      [
        String(f.properties.code),
        String(f.properties.name),
        f.properties.nameEn ?? null,
        f.properties.fullName ?? null,
        f.properties.areaKm2 ?? null,
        JSON.stringify(f.geometry),
      ]
    );
  }

  const wards = featuresOf(WARDS_FILE);
  for (const f of wards) {
    await client.query(
      `INSERT INTO admin.wards (code, province_code, name, name_en, full_name, area_km2, geom)
       VALUES ($1, $2, $3, $4, $5, $6, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)))`,
      [
        String(f.properties.code),
        String(f.properties.provinceCode),
        String(f.properties.name),
        f.properties.nameEn ?? null,
        f.properties.fullName ?? null,
        f.properties.areaKm2 ?? null,
        JSON.stringify(f.geometry),
      ]
    );
  }

  return { provinces: provinces.length, wards: wards.length };
}
