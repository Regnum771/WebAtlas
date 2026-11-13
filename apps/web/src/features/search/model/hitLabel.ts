import type { SearchHit } from '../api/search.api';

const LAYER_BADGE: Record<string, string> = {
  dams: 'Đập', lakes: 'Hồ', rivers: 'Sông', stations: 'Trạm',
};

/**
 * The tag shown before a hit's name. Reference hits are basemap data (a road, a railway, a water
 * body, a place), not one of the editable water layers; the raw OSM key ("roads") would be both
 * untranslated and misleading.
 */
export function hitBadge(hit: SearchHit): string {
  if (hit.source === 'reference') return 'Nền bản đồ';
  if (hit.source === 'admin') return hit.layerKey === 'province' ? 'Tỉnh' : 'Xã/phường';
  return LAYER_BADGE[hit.layerKey] ?? hit.layerKey;
}

/**
 * Many names already carry their layer word (HydroRIVERS names all start with "Sông"), so beside
 * the tag the raw name would read "Sông Sông Srêpốk": a leading tag word is dropped. A missing name
 * shows as "(không tên)" rather than throwing during render.
 */
export function hitDisplayName(name: string | null | undefined, badge: string): string {
  if (!name) return '(không tên)';
  const prefix = `${badge} `;
  return name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name;
}
