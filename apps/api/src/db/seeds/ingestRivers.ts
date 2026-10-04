import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { getPool, closePool } from '../pool';
import { loadFeatures, versionsService } from '@webatlas/versioning';
import type { SeedLayer } from './registry';
import { RIVER_WAY_COLUMNS } from '@webatlas/shared';
import { REACHES_LAYER } from './ingestReaches';

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
  file: resolvePath(here, '../../../../../packages/atlas-data/data/seeds/osm-rivers-region.geojson'),
  source: HYDRORIVERS_SOURCE,
  multiLine: true,
  columns: RIVER_WAY_COLUMNS,
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
    await loadFeatures(client, RIVERS_HYDRO_LAYER, versionId);
    await loadFeatures(client, REACHES_LAYER, versionId);
    // Dựng phân cấp sông, chạy cổng kích hoạt và đóng dấu mã hành chính đều là nghĩa vụ
    // của svc.activate() (xem versions/service.ts), không gọi tường minh ở đây. Vẫn cùng
    // giao dịch ingest, nên cổng thất bại thì ROLLBACK xoá sạch cả version.
    await svc.activate(client, 'rivers', versionId);
    // feature_count tính SAU activate(): phần dựng phân cấp chèn thêm các dòng sông cấp 1
    // vào chính version này, nên ways + reaches không còn đúng nữa.
    const { rows: fc } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers WHERE dataset_version_id = $1`,
      [versionId]
    );
    const count = Number(fc[0].n);
    await client.query(
      `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
      [count, versionId]
    );
    await client.query('COMMIT');
    result = { versionId, count };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  // water.rivers_overview giờ là view thường trên các sông cấp 1 (migration 20), nên
  // không còn ảnh chụp nào phải làm mới sau khi kích hoạt.
  return result;
}

// Run directly (npm run ingest:rivers), not when imported.
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMainModule) {
  ingestHydroRivers()
    .then(async (r) => {
      console.log(`rivers HydroRIVERS version ${r.versionId}: ${r.count} features`);
      return closePool();
    })
    .catch((err) => { console.error(err); process.exitCode = 1; return closePool(); });
}
