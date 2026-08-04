/**
 * Đối chiếu đập OSM (waterway=dam) với danh mục 371 đập của dự án.
 *
 * CHỈ SINH BÁO CÁO — không sửa dữ liệu. Danh mục có các trường ISO (công suất,
 * sản lượng, năm vận hành) mà OSM không có, nên không trộn tự động.
 *
 * Hai việc báo cáo giúp được:
 *   1. Đập OSM có tên nhưng không khớp danh mục -> có thể danh mục còn thiếu.
 *   2. 19 đập trong danh mục thiếu toạ độ -> gợi ý ứng viên OSM cùng tên.
 *
 * Chạy: node apps/api/scripts/report-dam-crosscheck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const cacheDir = path.join(scriptDir, '.osm-cache');
const outPath = path.join(repoRoot, 'docs/reports/dam-crosscheck.md');

/** Chuẩn hoá tên tiếng Việt để so khớp: bỏ dấu, bỏ ký tự đặc biệt, thường hoá. */
function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\b(thuy dien|ho chua|dap|nha may)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Đọc danh mục đập ĐẦY ĐỦ (trước khi cắt theo vùng).
 *
 * clip-to-region.mjs ghi đè file này tại chỗ, nên đọc thẳng từ working tree sẽ
 * đếm thiếu số đập ngoài vùng. Ưu tiên lấy bản gốc từ git; nếu không có
 * (repo chưa commit) thì mới dùng file trên đĩa.
 */
function readFullCatalogue() {
  const relPath = 'apps/web/public/thuydienvietnam.geojson';
  try {
    const fromGit = execFileSync('git', ['show', `HEAD:${relPath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(fromGit);
  } catch {
    console.warn('! Không lấy được bản gốc từ git — dùng file trên đĩa (có thể đã bị cắt).');
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
  }
}

const catalogue = readFullCatalogue();
const rawPath = path.join(cacheDir, 'osm-waterways-raw.geojson');
if (!fs.existsSync(rawPath)) {
  throw new Error(`Thiếu ${rawPath}. Chạy fetch-osm-waterways.mjs trước.`);
}
const osm = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

const osmDams = osm.features.filter((f) => f.properties?.waterway === 'dam');
const osmNamed = osmDams.filter((f) => f.properties.name);

const catByName = new Map();
for (const f of catalogue.features) {
  const key = normalizeName(f.properties.Vietnamese);
  if (key) catByName.set(key, f);
}

// 1. Đập OSM có tên nhưng không có trong danh mục.
const unmatched = osmNamed.filter((f) => !catByName.has(normalizeName(f.properties.name)));

// 2. Đập trong danh mục thiếu toạ độ + ứng viên OSM cùng tên.
const missingGeom = catalogue.features.filter((f) => !f.geometry);
const suggestions = missingGeom.map((f) => {
  const key = normalizeName(f.properties.Vietnamese);
  const match = osmNamed.find((o) => normalizeName(o.properties.name) === key);
  return { name: f.properties.Vietnamese, id: f.properties.ID, match };
});

const lines = [
  '# Báo cáo đối chiếu đập: OSM vs danh mục dự án',
  '',
  `*Sinh tự động bởi \`apps/api/scripts/report-dam-crosscheck.mjs\` — ${new Date().toISOString().slice(0, 10)}*`,
  '',
  '**Báo cáo này không sửa dữ liệu.** Danh mục dự án có các trường ISO (công suất,',
  'sản lượng, năm vận hành) mà OSM không có, nên mọi thay đổi phải do người rà soát quyết định.',
  '',
  '## Tổng quan',
  '',
  `- Danh mục dự án: **${catalogue.features.length}** đập (trong đó **${missingGeom.length}** thiếu toạ độ)`,
  `- OSM \`waterway=dam\` trong vùng: **${osmDams.length}** (trong đó **${osmNamed.length}** có tên)`,
  `- Đập OSM có tên nhưng không khớp danh mục: **${unmatched.length}**`,
  '',
  '## 1. Đập OSM không khớp danh mục',
  '',
  'Có thể là đập nhỏ/thuỷ lợi (không thuộc phạm vi danh mục thuỷ điện), hoặc là thiếu sót của danh mục.',
  '',
];

if (unmatched.length === 0) {
  lines.push('*Không có.*', '');
} else {
  lines.push('| Tên OSM | osmId |', '|---|---|');
  for (const f of unmatched) {
    lines.push(`| ${f.properties.name} | \`${f.properties.osmId}\` |`);
  }
  lines.push('');
}

lines.push(
  '## 2. Đập thiếu toạ độ trong danh mục',
  '',
  'Các đập này nằm trong DB với `geom = NULL` và không hiện trên bản đồ.',
  'Cột cuối là ứng viên OSM khớp tên — **cần kiểm tra thủ công trước khi dùng**.',
  ''
);

if (missingGeom.length === 0) {
  lines.push('*Không có.*', '');
} else {
  lines.push('| ID | Tên | Ứng viên OSM |', '|---|---|---|');
  for (const s of suggestions) {
    const hint = s.match ? `\`${s.match.properties.osmId}\` (${s.match.properties.name})` : '—';
    lines.push(`| ${s.id} | ${s.name} | ${hint} |`);
  }
  lines.push('');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`Đã ghi ${outPath}`);
console.log(`  ${unmatched.length} đập OSM không khớp; ${missingGeom.length} đập thiếu toạ độ`);
