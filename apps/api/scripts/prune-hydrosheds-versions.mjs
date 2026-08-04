/**
 * Xóa các version HydroSHEDS/thuyhe khỏi DB sau khi đã chuyển sang OSM.
 *
 * An toàn: TỪ CHỐI xóa nếu version đó đang active, để không bao giờ xoá mất dữ
 * liệu đang được phục vụ.
 *
 * File seed vẫn còn trong git — nếu cần quay lại, chạy lại seed/ingest.
 *
 * Chạy: node apps/api/scripts/prune-hydrosheds-versions.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const OBSOLETE_SOURCES = [
  'HydroRIVERS v10',
  'HydroRIVERS v10 vn-clip',
  'HydroLAKES v10',
  'HydroLAKES v10 vn-clip',
  'thuyhe.geojson',
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL chưa được đặt');

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  const { rows } = await client.query(
    `SELECT id, layer_key, source, feature_count, is_active
     FROM app.dataset_versions WHERE source = ANY($1) ORDER BY layer_key`,
    [OBSOLETE_SOURCES]
  );

  if (rows.length === 0) {
    console.log('Không còn version cũ nào — không có gì để xóa.');
  } else {
    const active = rows.filter((r) => r.is_active);
    if (active.length) {
      console.error('TỪ CHỐI XÓA: các version sau đang active —');
      for (const r of active) console.error(`  ${r.layer_key} "${r.source}"`);
      console.error('Hãy chạy seed + ingest:rivers để OSM thành active trước.');
      process.exitCode = 1;
    } else {
      await client.query('BEGIN');
      for (const r of rows) {
        // Xóa feature trước, rồi tới version (khoá ngoại).
        await client.query(`DELETE FROM water.${r.layer_key} WHERE dataset_version_id = $1`, [r.id]);
        await client.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [r.id]);
        console.log(`đã xóa ${r.layer_key} "${r.source}" (${r.feature_count} đối tượng)`);
      }
      await client.query('COMMIT');
      console.log(`\nXóa xong ${rows.length} version cũ.`);
    }
  }
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
