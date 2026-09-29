import {
  MAX_RESULT_ITEMS,
  capResultItems,
  type AnalysisResult,
  type AnalysisRow,
  type GeoJsonGeometry,
  type ResultGeometry,
  type Roi,
} from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import {
  LAYER_LABELS, POINT_SQL, ROW_LIMIT, candidateCtes, entityPredicate, layerTable, type Queryable,
} from '../../assistant/tools/data/helpers';
import { requireArea } from '../../roi/kind';
import { resolveRoi } from '../../roi/resolve';
import type { SelectWithinInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/**
 * Features of each layer inside the ROI. The candidate step reaches the base table's
 * index; the real predicate, NOT deleted and the entity predicate are re-applied after
 * version resolution (handover §4.2). `count(*) OVER ()` is computed before LIMIT, so
 * counts are full even when drawing is capped.
 */
export async function selectWithinOp(db: Queryable, input: SelectWithinInput): Promise<AnalysisResult> {
  const { resolved, geojson } = await resolveRoi(db, input.roi as Roi);
  requireArea(resolved, 'Chọn trong vùng');

  // The area test as SQL over one layer's rows ($1), and its parameter.
  const inArea = { sql: `geom && ${GEOM} AND ST_Intersects(geom, ${GEOM})`, param: geojson as string };

  const summary: Record<string, number | string> = { 'Tổng số': 0 };
  const rows: AnalysisRow[] = [];
  const highlights: ResultGeometry[] = [];
  let total = 0;

  for (const key of input.layerKeys) {
    const entity = entityPredicate(key);
    const ctes = candidateCtes(key, `SELECT external_id FROM ${layerTable(key)} WHERE ${inArea.sql} AND ${entity}`);
    const { rows: found } = await db.query<{
      featureId: string; name: string | null; lon: number; lat: number; geometry: GeoJsonGeometry; total: string;
    }>(
      `WITH RECURSIVE ${ctes}
       SELECT id::text AS "featureId", name, ${POINT_SQL},
              ${simplifiedGeoJsonSql('geom')} AS geometry,
              count(*) OVER () AS total
         FROM resolved
        WHERE NOT deleted AND geom IS NOT NULL AND ${inArea.sql} AND ${entity}
        ORDER BY name NULLS LAST
        LIMIT $2`,
      [inArea.param, MAX_RESULT_ITEMS]
    );
    const n = found.length > 0 ? Number(found[0].total) : 0;
    summary[LAYER_LABELS[key]] = n;
    total += n;
    for (const f of found) {
      highlights.push({
        geometry: f.geometry, role: 'highlight', layerKey: key, featureId: f.featureId,
        ...(f.name ? { label: f.name } : {}),
      });
      if (rows.length < ROW_LIMIT) {
        rows.push({ layerKey: key, featureId: f.featureId, name: f.name, lon: f.lon, lat: f.lat });
      }
    }
  }

  summary['Tổng số'] = total;
  summary['Diện tích vùng (km²)'] = (resolved.measure as { areaKm2: number }).areaKm2;
  const capped = capResultItems([
    { geometry: resolved.display, role: 'input', label: resolved.label },
    ...highlights,
  ]);
  return {
    op: 'select_within',
    summary,
    rows,
    geometries: capped.items,
    truncated: capped.truncated || highlights.length < total,
  };
}
