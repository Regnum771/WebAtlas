import type { Pool } from 'pg';
import { NotFoundError } from '../../errors';
import type { CurrentUser } from '../../types/fastify';
import { canDownload, isOwner, isPublic, visibleSql } from './access';

export const PAGE_SIZE = 20;
export const ITEM_NOT_FOUND = 'Không tìm thấy dữ liệu trong Danh mục.';

export interface CatalogueItem {
  id: string;
  kind: 'vector' | 'raster' | 'timeseries' | 'map' | 'document';
  title: string;
  abstract: string;
  managingUnit: string;
  isPublished: boolean;
  /** Seen by everyone: published, and GeoNode lets anonymous users view it. */
  isPublic: boolean;
  mine: boolean;
  /** The caller may copy its data (GeoNode's anonymous download, or the caller owns it). */
  downloadable: boolean;
  variable: string | null;
  unit: string | null;
  timeSteps: string[] | null;
  bbox4326: [number, number, number, number] | null;
  /** GeoNode's `alternate`, e.g. geonode:ts_1a2b3c4d. Null for a map or a document: neither has a GeoServer layer of its own. */
  layerName: string | null;
  /** When the entry last changed here (ISO 8601), for "Mới cập nhật". */
  updatedAt: string;
}

interface ResourceRow {
  id: string;
  kind: CatalogueItem['kind'];
  title: string;
  abstract: string;
  managing_unit: string;
  is_published: boolean;
  public_view: boolean;
  public_download: boolean;
  owner_sub: string | null;
  variable: string | null;
  unit: string | null;
  time_steps: Date[] | null;
  bbox4326: number[] | null;
  alternate: string | null;
  updated_at: Date;
}

const COLS = `id, kind, title, abstract, managing_unit, is_published, public_view, public_download, owner_sub, variable, unit,
              time_steps, bbox4326::float8[] AS bbox4326, alternate, updated_at`;

function toItem(row: ResourceRow, user: CurrentUser | undefined): CatalogueItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    abstract: row.abstract,
    managingUnit: row.managing_unit,
    isPublished: row.is_published,
    isPublic: isPublic(row),
    mine: isOwner(user, row),
    downloadable: canDownload(user, row),
    variable: row.variable,
    unit: row.unit,
    timeSteps: row.time_steps ? row.time_steps.map((d) => d.toISOString()) : null,
    bbox4326: row.bbox4326 ? (row.bbox4326.map(Number) as CatalogueItem['bbox4326']) : null,
    layerName: row.alternate,
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * The entries among `ids` that `user` may see, by id, in one query. A missing or invisible id is
 * simply absent: a personal map's link layer (workspace/freeLayers.ts withCatalogue) reads it as
 * null, so a recipient never learns of an entry only its owner may see.
 */
export async function visibleItems(
  q: Pick<Pool, 'query'>, user: CurrentUser | undefined, ids: string[]
): Promise<Map<string, CatalogueItem>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query<ResourceRow>(
    `SELECT ${COLS} FROM catalogue.resources WHERE id = ANY($2::uuid[]) AND ${visibleSql(1)}`,
    [user?.oidcSubject ?? null, [...new Set(ids)]]
  );
  return new Map(rows.map((r) => [r.id, toItem(r, user)]));
}

/** Escape LIKE wildcards so a search for "50%" finds a literal percent sign. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function catalogueRepository(pg: Pool) {
  return {
    /**
     * Visible resources, newest first. `q` matches title or abstract ignoring case and Vietnamese
     * diacritics (workspace.fold_text, migration 31, on both sides).
     */
    async search(user: CurrentUser | undefined, input: { q?: string; kind?: string; page: number }) {
      const sub = user?.oidcSubject ?? null;
      const pattern = input.q ? `%${likeEscape(input.q)}%` : null;
      const kind = input.kind ?? null;
      const { rows } = await pg.query<ResourceRow & { total: string }>(
        `SELECT ${COLS}, count(*) OVER () AS total
           FROM catalogue.resources
          WHERE ${visibleSql(1)}
            AND ($2::text IS NULL OR kind = $2)
            AND ($3::text IS NULL OR workspace.fold_text(title) LIKE workspace.fold_text($3)
                                  OR workspace.fold_text(abstract) LIKE workspace.fold_text($3))
          ORDER BY created_at DESC, id
          LIMIT ${PAGE_SIZE} OFFSET $4`,
        [sub, kind, pattern, (input.page - 1) * PAGE_SIZE]
      );
      let total = rows.length > 0 ? Number(rows[0].total) : 0;
      if (rows.length === 0 && input.page > 1) {
        // A page past the end: the window count is gone with the rows, so count separately.
        const { rows: c } = await pg.query<{ n: string }>(
          `SELECT count(*) AS n FROM catalogue.resources
            WHERE ${visibleSql(1)}
              AND ($2::text IS NULL OR kind = $2)
              AND ($3::text IS NULL OR workspace.fold_text(title) LIKE workspace.fold_text($3)
                                    OR workspace.fold_text(abstract) LIKE workspace.fold_text($3))`,
          [sub, kind, pattern]
        );
        total = Number(c[0].n);
      }
      return { items: rows.map((r) => toItem(r, user)), total, page: input.page, pageSize: PAGE_SIZE };
    },

    /**
     * The `limit` visible resources changed last (the hub's "Mới cập nhật"), newest first: the same
     * visibility as search, ordered by updated_at rather than created_at.
     */
    async recent(user: CurrentUser | undefined, limit: number): Promise<CatalogueItem[]> {
      const { rows } = await pg.query<ResourceRow>(
        `SELECT ${COLS} FROM catalogue.resources
          WHERE ${visibleSql(1)}
          ORDER BY updated_at DESC, id
          LIMIT $2`,
        [user?.oidcSubject ?? null, limit]
      );
      return rows.map((r) => toItem(r, user));
    },

    /** One visible resource; one that is missing or not visible to the caller is the same 404. */
    async get(user: CurrentUser | undefined, id: string): Promise<CatalogueItem> {
      const item = (await visibleItems(pg, user, [id])).get(id);
      if (!item) throw new NotFoundError(ITEM_NOT_FOUND);
      return item;
    },

    /**
     * What a GeoNode Map is made of (catalogue.map_composition, synced from GeoNode's own layer
     * list): its constituent layers, in GeoNode's order, each one the caller may see. A layer the
     * sync could not resolve yet, or one the caller may not see, is left out rather than failing
     * the whole list — the Map still expands into however much of it is usable. 404 when `id` is
     * not a visible 'map' entry.
     */
    async mapLayers(user: CurrentUser | undefined, id: string): Promise<MapLayerEntry[]> {
      const map = (await visibleItems(pg, user, [id])).get(id);
      if (!map || map.kind !== 'map') throw new NotFoundError(ITEM_NOT_FOUND);
      const { rows } = await pg.query<{ layer_resource_id: string | null; visible: boolean; opacity: number }>(
        `SELECT layer_resource_id, visible, opacity FROM catalogue.map_composition
          WHERE map_resource_id = $1 ORDER BY position`,
        [id]
      );
      const layerIds = rows.map((r) => r.layer_resource_id).filter((v): v is string => v !== null);
      const items = await visibleItems(pg, user, layerIds);
      return rows
        .filter((r) => r.layer_resource_id !== null && items.has(r.layer_resource_id))
        .map((r) => ({ item: items.get(r.layer_resource_id as string) as CatalogueItem, visible: r.visible, opacity: r.opacity }));
    },
  };
}

export interface MapLayerEntry {
  item: CatalogueItem;
  /** Whether GeoNode showed this layer in the Map; applied once, client-side, when it is added. */
  visible: boolean;
  opacity: number;
}
