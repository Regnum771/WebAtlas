import { defineDataset } from '../schema';
import { allOf, rowCount } from '../probes';

const LAYERS = ['roads', 'railways', 'water', 'landuse', 'places'] as const;

/**
 * Runbook step 6: basemap.reference_entities, rebuilt from the raw basemap tables. load_basemap.py
 * drops and recreates those tables, so this is stale the moment the basemap reloads — which
 * dependsOn now enforces (spec FR-8) instead of a runbook paragraph.
 */
export const referenceEntities = defineDataset({
  id: 'reference_entities',
  kind: 'derived',
  dependsOn: ['basemap'],
  lineage: {
    statement: 'Thực thể có tên (đường, đường sắt, mặt nước, sử dụng đất, địa danh) gộp từ các bảng nền thô.',
    licence: 'ODbL-1.0',
    sources: [],
  },
  stages: [
    {
      type: 'run',
      in: 'host',
      argv: ['run', 'reference:build', '-w', '@webatlas/api'],
      produces: 'basemap.reference_entities',
      promoteTo: 'sql',
      promoteBy: '2027-06-30',
    },
  ],
  probe: allOf(
    ...LAYERS.map((k) =>
      rowCount(`reference ${k}`, `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = '${k}'`)
    )
  ),
});
