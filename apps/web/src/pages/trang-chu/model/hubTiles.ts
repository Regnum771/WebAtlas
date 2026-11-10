import type { CurrentUser } from '../../../entities/session/model/session.types';
import type { PlatformService, PlatformServiceId } from '../../../entities/platform/model/platform.types';
import { canSeeQuanLy, type CanFn } from '../../quan-ly/model/visibility';

/** 'checking': the API has not answered yet. */
export type TileState = 'ready' | 'checking' | 'down' | 'unconfigured';

export type HubTile =
  | { id: string; kind: 'route'; to: string; title: string; text: string }
  | { id: PlatformServiceId; kind: 'service'; href: string | null; title: string; text: string; state: TileState };

function serviceTile(
  id: PlatformServiceId, title: string, text: string, services: PlatformService[] | null,
): HubTile {
  const s = services?.find((x) => x.id === id) ?? null;
  const state: TileState = services === null ? 'checking'
    : !s || s.status === 'unconfigured' || !s.url ? 'unconfigured'
    : s.status === 'down' ? 'down' : 'ready';
  return { id, kind: 'service', href: s?.url ?? null, title, text, state };
}

/** The hub's tiles in order. Visibility is UX only; each service enforces its own access. */
export function hubTiles(user: CurrentUser | null, can: CanFn, services: PlatformService[] | null): HubTile[] {
  const tiles: HubTile[] = [
    { id: 'ban-do', kind: 'route', to: '/ban-do', title: 'Bản đồ tương tác', text: 'Xem, phân tích, in bản đồ; biên tập khi được giao quyền.' },
    serviceTile('geonode', 'Danh mục bản đồ', 'Tập dữ liệu, siêu dữ liệu, bản đồ và bảng điều khiển.', services),
  ];
  if (user?.isAdmin) {
    tiles.push(serviceTile('dagster', 'Điều phối dữ liệu', 'Luồng dữ liệu, lịch chạy và lịch sử chạy.', services));
  }
  tiles.push({ id: 'du-lieu', kind: 'route', to: '/du-lieu', title: 'Từ điển dữ liệu', text: 'Định nghĩa lớp, trường và mã giá trị.' });
  if (canSeeQuanLy(user, can)) {
    tiles.push({ id: 'quan-ly', kind: 'route', to: '/quan-ly', title: 'Quản lý', text: 'Nhóm quyền, người dùng và đơn vị chủ quản.' });
  }
  if (user) {
    tiles.push({ id: 'ho-so', kind: 'route', to: '/ho-so', title: 'Hồ sơ', text: 'Tài khoản và phạm vi quyền của bạn.' });
  }
  return tiles;
}
