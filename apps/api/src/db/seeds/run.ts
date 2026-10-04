import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { getPool, closePool } from '../pool';
import { SEED_LAYERS } from './registry';
import { loadFeatures, versionsService } from '@webatlas/versioning';
import { loadAdminBoundaries } from './adminBoundaries';

export async function runSeeds(): Promise<Record<string, number>> {
  const pool = getPool();
  const client = await pool.connect();
  const versions = versionsService(pool);
  const result: Record<string, number> = {};
  try {
    // Ranh giới trước dữ liệu chuyên đề: bước đóng dấu mã hành chính (db/adminStamp.ts)
    // chạy ngay sau khi nạp từng lớp và cần hai bảng này đã có dữ liệu.
    await client.query('BEGIN');
    try {
      const admin = await loadAdminBoundaries(client);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`seeded admin boundaries: ${admin.provinces} provinces, ${admin.wards} wards`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    for (const layer of SEED_LAYERS) {
      // One transaction per layer: create the version, load its features, record the
      // count, then flip active. A failure anywhere rolls the whole layer back and
      // leaves the previously-active version untouched.
      await client.query('BEGIN');
      // label is omitted: createIngestVersion derives a sequential "version N" per layer.
      const versionId = await versions.createIngestVersion(client, {
        layerKey: layer.table,
        source: layer.source,
      });
      result[layer.table] = await loadFeatures(client, layer, versionId);
      await client.query(
        `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
        [result[layer.table], versionId]
      );
      // Đóng dấu mã hành chính giờ là nghĩa vụ của versions.activate() (xem service.ts):
      // không còn gọi tường minh ở đây.
      await versions.activate(client, layer.table, versionId);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`seeded water.${layer.table}: ${result[layer.table]} features (version ${versionId})`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return result;
}

// Run when invoked directly (npm run seed), but not when imported (e.g. by seed.test.ts).
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMainModule) {
  runSeeds()
    .then(() => closePool())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
      return closePool();
    });
}
