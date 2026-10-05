/**
 * Filters every thematic dataset down to the working region (6 provinces).
 *
 * Works on the seed files in place (overwrites them). The seed data is committed, so
 * `git restore` brings it back if needed.
 *
 * Run: node packages/atlas-data/tools/clip-to-region.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegionRings, featureIntersectsRegion } from './lib/regionClip.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const dataDir = path.join(repoRoot, 'packages/atlas-data/data/seeds');
const provincesPath = path.join(dataDir, 'provinces-34.geojson');

// Keep in step with REGION_PROVINCE_CODES in packages/shared/src/region.ts.
const REGION_CODES = ['48', '51', '52', '56', '66', '68'];

// Every thematic seed file. A layer with no file yet is skipped silently.
// Dams matter here: 205 of the 371 dams lie outside the region unless clipped.
const TARGETS = [
  path.join(dataDir, 'osm-rivers-region.geojson'),
  path.join(dataDir, 'osm-lakes-region.geojson'),
  path.join(dataDir, 'stations.geojson'),
  path.join(dataDir, 'flood_zones.geojson'),
  path.join(dataDir, 'drought_points.geojson'),
  path.join(dataDir, 'saltwater_intrusion.geojson'),
  path.join(dataDir, 'flood_generation.geojson'),
  path.join(dataDir, 'dams.geojson'),
];

const provinces = JSON.parse(fs.readFileSync(provincesPath, 'utf8'));
const rings = buildRegionRings(provinces, REGION_CODES);
console.log(`Ranh giới vùng: ${rings.length} polygon từ ${REGION_CODES.length} tỉnh`);

for (const filePath of TARGETS) {
  const file = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    console.log(`${file}: (không có, bỏ qua)`);
    continue;
  }
  const fc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const before = fc.features.length;
  // Dams without coordinates (null geom) are kept: they are valid catalogue records,
  // reported separately in Task 13 and filtered out in the frontend.
  fc.features = fc.features.filter((f) => !f.geometry || featureIntersectsRegion(f, rings));
  const after = fc.features.length;
  fs.writeFileSync(filePath, JSON.stringify(fc));
  const mb = (fs.statSync(filePath).size / 1048576).toFixed(1);
  console.log(`${file}: ${before} -> ${after} (bỏ ${before - after}), ${mb} MB`);
}
