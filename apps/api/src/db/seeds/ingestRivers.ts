import { fileURLToPath } from 'node:url';
import { refreshRiverOverview } from '../riverOverview';
import { resolve as resolvePath } from 'node:path';
import { getPool, closePool } from '../pool';
import { versionsService } from '../../modules/versions/service';
import { loadLayerFeatures } from './run';
import type { SeedLayer } from './registry';
import { REACHES_LAYER } from './ingestReaches';
import { materialiseResolved, assignReachNames } from '../riverHierarchy';

const here = fileURLToPath(new URL('.', import.meta.url));
// Đổi chuỗi này mỗi khi nội dung file seed đổi: hàm ingest dưới đây idempotent
// THEO SOURCE, nên giữ nguyên chuỗi sẽ khiến nó kích hoạt lại version cũ thay vì
// nạp dữ liệu mới. Đổi lần này vì version giờ chứa CẢ đoạn sông HydroRIVERS (cấp 2),
// không chỉ đường OSM (cấp 3).
const HYDRORIVERS_SOURCE = 'OSM waterways + HydroRIVERS v10';

// OSM waterways → các cột `rivers` sẵn có. Khác HydroRIVERS: OSM CÓ tên sông,
// và `stream_order` giờ là hạng theo loại chứ không phải bậc Strahler.
//
// Exported so the column map is unit-testable without a database: the 'osm:' prefix is
// a contract other sources depend on, not an implementation detail.
export const RIVERS_HYDRO_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, 'data/osm-rivers-region.geojson'),
  source: HYDRORIVERS_SOURCE,
  multiLine: true,
  columns: (p) => ({
    // 'osm:' so an OSM way id can never be mistaken for a HYRIV_ID (migration 18).
    external_id: `osm:${String(p.osmId)}`,
    code: p.waterway,
    name: p.name,
    stream_order: p.streamOrder,
    // Độ dài do build-osm-seeds.mjs tính từ hình học (OSM không có sẵn trường này).
    length_m: p.lengthM,
  }),
};

/**
 * Ingest OSM waterways (level 3) and HydroRIVERS reaches (level 2) into ONE new active
 * `rivers` version, off the versioning foundation. An ingest version has no parent (the
 * kind/parent_version_id check constraint in migration 1000000000004), so rivers_active
 * resolves its chain to that version alone -- loading the two levels into separate
 * versions would make one level invisible to every reader. Idempotent: if a version for
 * this source already exists, return it without creating a duplicate (so re-running is
 * safe).
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
      // Đóng dấu mã hành chính giờ là nghĩa vụ của svc.activate() (xem versions/service.ts):
      // nhánh này tái dùng phiên bản cũ nên vẫn cần đóng dấu lại, nhưng activate() tự lo,
      // không cần gọi tường minh ở đây nữa.
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
    // One ingest version is one COMPLETE snapshot of the layer: app.dataset_versions'
    // kind/parent constraint gives an ingest version no parent, so rivers_active
    // resolves its chain to this version alone. Loading the reaches into a separate
    // ingest version would make every OSM way vanish from the map.
    const ways = await loadLayerFeatures(client, RIVERS_HYDRO_LAYER, versionId);
    const reaches = await loadLayerFeatures(client, REACHES_LAYER, versionId);
    const count = ways + reaches;
    await client.query(
      `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
      [count, versionId]
    );
    // Gán tên cho đoạn sông cấp 2 trước activate(): chạy trong cùng giao dịch ingest
    // để ROLLBACK khi lỗi xoá sạch cả version, đúng như spec "failure means the
    // version is not activated" (xem riverHierarchy.ts).
    await materialiseResolved(client, versionId);
    const named = await assignReachNames(client, versionId);
    console.log(`  named ${named.matched} reaches across ${named.names} rivers`);
    // Đóng dấu mã hành chính giờ là nghĩa vụ của svc.activate() (xem versions/service.ts):
    // không còn gọi tường minh ở đây.
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
