import { CONTOUR_INTERVALS } from '@webatlas/shared';
import { getPool, closePool } from '../db/pool';

/**
 * Sinh đường đồng mức từ basemap.dem_region vào basemap.contours.
 *
 * Chạy một lần bởi lập trình viên, KHÔNG chạy trong CI:
 *   npm run contours:generate -w @webatlas/api
 *
 * Cần DEM đã nạp trước (docs/runbooks/elevation-dem.md). Mất khoảng 30 phút cho cả ba
 * khoảng cao đều — 28 giây mỗi ô 1 độ mỗi khoảng, 19 ô.
 */

/** Dung sai đơn giản hoá: 0,0002 độ ~ 22 m, NHỎ HƠN một ô lưới DEM 30 m, nên hình dạng
 *  không đổi mà số đỉnh giảm 5,9 lần. */
const SIMPLIFY_TOLERANCE_DEG = 0.0002;

/** Phần đệm quanh mỗi ô khi cắt DEM. ST_Contour chạy trên từng ô rời nhau sẽ để lại khe
 *  hở tại đường ghép; cắt rộng ra rồi cắt đường trở lại đúng ranh ô thì hai bên gặp nhau.
 *  0,01 độ ~ 1,1 km, thừa sức so với bước lưới. */
const CELL_OVERLAP_DEG = 0.01;

export interface Cell {
  lon: number;
  lat: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Các ô 1 độ phủ hết bounds, kể cả ô chỉ bị cắt một phần ở rìa. */
export function cellsCovering(b: Bounds): Cell[] {
  const cells: Cell[] = [];
  for (let lat = Math.floor(b.south); lat < Math.ceil(b.north); lat++) {
    for (let lon = Math.floor(b.west); lon < Math.ceil(b.east); lon++) {
      cells.push({ lon, lat });
    }
  }
  return cells;
}

/**
 * Đường cái: cứ 5 đường thì 1. So sánh có sai số vì ST_Contour trả về số thực — dùng
 * modulo trực tiếp thì 1500,0000001 không còn là đường cái, dù người đọc thấy nó là 1500.
 */
export function isIndexContour(elevationM: number, intervalM: number): boolean {
  const step = intervalM * 5;
  const r = Math.abs(elevationM) % step;
  return r < 0.001 || step - r < 0.001;
}

async function main(): Promise<void> {
  const pool = getPool();
  const { rows: extent } = await pool.query<Bounds & { n: string }>(`
    SELECT count(*)::text AS n,
           ST_XMin(ST_Union(ST_ConvexHull(rast))) AS west,
           ST_YMin(ST_Union(ST_ConvexHull(rast))) AS south,
           ST_XMax(ST_Union(ST_ConvexHull(rast))) AS east,
           ST_YMax(ST_Union(ST_ConvexHull(rast))) AS north
      FROM basemap.dem_region
  `);
  if (Number(extent[0].n) === 0) {
    throw new Error(
      'basemap.dem_region rỗng — nạp DEM trước: xem docs/runbooks/elevation-dem.md'
    );
  }
  const cells = cellsCovering(extent[0]);
  console.log(`DEM: ${extent[0].n} tile, ${cells.length} ô 1 độ`);

  await pool.query('TRUNCATE basemap.contours');

  for (const intervalM of CONTOUR_INTERVALS) {
    const started = Date.now();
    let inserted = 0;
    for (const { lon, lat } of cells) {
      const { rowCount } = await pool.query(
        `WITH padded AS (
           SELECT ST_Union(rast) AS rast
             FROM basemap.dem_region
            WHERE ST_Intersects(rast, ST_MakeEnvelope($1::float8 - $5::float8, $2::float8 - $5::float8, $1::float8 + 1 + $5::float8, $2::float8 + 1 + $5::float8, 4326))
         ),
         lines AS (
           SELECT (ST_Contour(rast, 1, $3::float8)).*
             FROM padded WHERE rast IS NOT NULL
         ),
         clipped AS (
           -- Cắt trở lại ĐÚNG ô: phần đệm chỉ để hai ô cạnh nhau gặp nhau, giữ lại thì
           -- mỗi đường biên bị chèn hai lần.
           SELECT value AS elevation_m,
                  ST_Intersection(geom, ST_MakeEnvelope($1, $2, $1 + 1, $2 + 1, 4326)) AS geom
             FROM lines
         )
         INSERT INTO basemap.contours (interval_m, elevation_m, is_index, geom)
         SELECT $3, elevation_m,
                abs(mod(abs(elevation_m)::numeric, ($3 * 5)::numeric)) < 0.001
                  OR ($3 * 5) - abs(mod(abs(elevation_m)::numeric, ($3 * 5)::numeric)) < 0.001,
                ST_Multi(ST_SimplifyPreserveTopology(geom, $4))
           FROM clipped
          WHERE NOT ST_IsEmpty(geom) AND ST_GeometryType(geom) IN ('ST_LineString', 'ST_MultiLineString')`,
        [lon, lat, intervalM, SIMPLIFY_TOLERANCE_DEG, CELL_OVERLAP_DEG]
      );
      inserted += rowCount ?? 0;
      process.stdout.write(`\r  ${intervalM} m: ${inserted} đường`);
    }
    console.log(`\r  ${intervalM} m: ${inserted} đường (${Math.round((Date.now() - started) / 1000)} s)`);
  }

  const { rows: summary } = await pool.query<{ interval_m: number; features: string; vertices: string }>(
    `SELECT interval_m, count(*)::text AS features, sum(ST_NPoints(geom))::text AS vertices
       FROM basemap.contours GROUP BY interval_m ORDER BY interval_m DESC`
  );
  console.table(summary);
  await closePool();
}

// Chỉ chạy khi gọi trực tiếp, để test import được các hàm thuần ở trên.
if (process.argv[1]?.includes('generateContours')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
