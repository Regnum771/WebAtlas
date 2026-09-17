import { fileURLToPath } from 'node:url';
import { refreshRiverOverview } from '../riverOverview';
import { resolve as resolvePath } from 'node:path';
import { getPool, closePool } from '../pool';
import { versionsService } from '../../modules/versions/service';
import { loadLayerFeatures } from './run';
import type { SeedLayer } from './registry';

const here = fileURLToPath(new URL('.', import.meta.url));
// Đổi chuỗi này mỗi khi nội dung file seed đổi: hàm ingest dưới đây idempotent
// THEO SOURCE, nên giữ nguyên chuỗi sẽ khiến nó kích hoạt lại version cũ thay vì
// nạp dữ liệu mới.
const HYDRORIVERS_SOURCE = 'OSM waterways';

// OSM waterways → các cột `rivers` sẵn có. Khác HydroRIVERS: OSM CÓ tên sông,
// và `stream_order` giờ là hạng theo loại chứ không phải bậc Strahler.
const RIVERS_HYDRO_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, 'data/osm-rivers-region.geojson'),
  source: HYDRORIVERS_SOURCE,
  multiLine: true,
  columns: (p) => ({
    external_id: p.osmId,
    code: p.waterway,
    name: p.name,
    stream_order: p.streamOrder,
    // Độ dài do build-osm-seeds.mjs tính từ hình học (OSM không có sẵn trường này).
    length_m: p.lengthM,
  }),
};

/**
 * Ingest HydroRIVERS as a new active `rivers` version, off the versioning foundation.
 * Idempotent: if a HydroRIVERS ingest version already exists, return it without
 * creating a duplicate (so re-running is safe).
 */
export async function ingestHydroRivers(): Promise<{ versionId: string; count: number }> {
  const pool = getPool();
  const svc = versionsService(pool);

  const existing = await pool.query(
    `SELECT id, feature_count FROM app.dataset_versions
     WHERE layer_key = 'rivers' AND source = $1 AND kind = 'ingest'
     ORDER BY ingested_at DESC LIMIT 1`,
    [HYDRORIVERS_SOURCE]
  );
  if (existing.rows[0]) {
    const id = existing.rows[0].id as string;
    // Ensure it's the active version, then return it.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await svc.activate(client, 'rivers', id);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { versionId: id, count: existing.rows[0].feature_count ?? 0 };
  }

  let result: { versionId: string; count: number };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const versionId = await svc.createIngestVersion(client, {
      layerKey: 'rivers',
      source: HYDRORIVERS_SOURCE,
    });
    const count = await loadLayerFeatures(client, RIVERS_HYDRO_LAYER, versionId);
    await client.query(
      `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
      [count, versionId]
    );
    await svc.activate(client, 'rivers', versionId);
    await client.query('COMMIT');
    result = { versionId, count };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Làm mới ảnh chụp ngay tại đây, không để cho người gọi. Trước đây việc này nằm
  // trong khối isMainModule bên dưới, nên chỉ `npm run ingest:rivers` mới làm —
  // còn ai gọi thẳng ingestHydroRivers() thì kích hoạt một phiên bản 'rivers' mới
  // và bỏ lại water.rivers_overview là ảnh chụp của phiên bản CŨ. Không báo lỗi ở
  // đâu cả: bản đồ ở mức thu nhỏ lặng lẽ vẽ mạng lưới cũ.
  //
  // Sau COMMIT và ngoài giao dịch, vì REFRESH MATERIALIZED VIEW CONCURRENTLY không
  // chạy được bên trong một khối giao dịch. Dùng `pool` chứ không phải `client`, vì
  // client đã được trả lại ở khối finally ngay trên.
  await refreshRiverOverview(pool);
  return result;
}

// Run directly (npm run ingest:rivers), not when imported.
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMainModule) {
  ingestHydroRivers()
    .then(async (r) => {
      console.log(`rivers HydroRIVERS version ${r.versionId}: ${r.count} features`);
      // Không làm mới ở đây nữa: ingestHydroRivers() tự lo, nên mọi người gọi đều
      // được, không riêng đường chạy từ dòng lệnh này.
      console.log('refreshed water.rivers_overview');
      return closePool();
    })
    .catch((err) => { console.error(err); process.exitCode = 1; return closePool(); });
}
