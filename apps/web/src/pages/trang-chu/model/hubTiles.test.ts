import { describe, it, expect } from 'vitest';
import { hubTiles, type HubTile } from './hubTiles';
import type { CurrentUser } from '../../../entities/session/model/session.types';
import type { PlatformService } from '../../../entities/platform/model/platform.types';

const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
  id: '1', email: 'a@b.test', full_name: null, role: 'viewer', isAdmin: false, grants: [], ...over,
});
const canNone = () => false;
const canAll = () => true;
const svc = (id: PlatformService['id'], url: string | null, status: PlatformService['status']): PlatformService =>
  ({ id, label: id, url, status, checkedAt: '' });
const ids = (tiles: HubTile[]) => tiles.map((t) => t.id);
const service = (tiles: HubTile[], id: string) => tiles.find((t) => t.id === id) as Extract<HubTile, { kind: 'service' }>;

describe('hubTiles', () => {
  it('a visitor sees the map, the catalogue and the dictionary', () => {
    expect(ids(hubTiles(null, canNone, []))).toEqual(['ban-do', 'geonode', 'du-lieu']);
  });

  it('a signed-in reader also gets Hồ sơ; an admin gets Điều phối and Quản lý', () => {
    expect(ids(hubTiles(user(), canNone, []))).toEqual(['ban-do', 'geonode', 'du-lieu', 'ho-so']);
    expect(ids(hubTiles(user({ role: 'admin', isAdmin: true }), canAll, [])))
      .toEqual(['ban-do', 'geonode', 'dagster', 'du-lieu', 'quan-ly', 'ho-so']);
  });

  it('the map tile goes to /ban-do', () => {
    expect(hubTiles(null, canNone, [])[0]).toMatchObject({ kind: 'route', to: '/ban-do' });
  });

  it('a service tile is checking, ready, down or unconfigured', () => {
    expect(service(hubTiles(null, canNone, null), 'geonode')).toMatchObject({ state: 'checking', href: null });
    expect(service(hubTiles(null, canNone, [svc('geonode', 'http://localhost:8000/', 'up')]), 'geonode'))
      .toMatchObject({ state: 'ready', href: 'http://localhost:8000/' });
    expect(service(hubTiles(null, canNone, [svc('geonode', 'http://localhost:8000/', 'down')]), 'geonode'))
      .toMatchObject({ state: 'down', href: 'http://localhost:8000/' });
    expect(service(hubTiles(null, canNone, [svc('geonode', null, 'unconfigured')]), 'geonode'))
      .toMatchObject({ state: 'unconfigured', href: null });
    expect(service(hubTiles(null, canNone, []), 'geonode')).toMatchObject({ state: 'unconfigured' });
  });
});
