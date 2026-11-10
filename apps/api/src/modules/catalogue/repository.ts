import type { Pool } from 'pg';
import { NotFoundError } from '../../errors';
import type { CurrentUser } from '../../types/fastify';
import { isOwner, visibleSql } from './access';

export const PAGE_SIZE = 20;
export const ITEM_NOT_FOUND = 'Không tìm thấy dữ liệu trong Danh mục.';

export interface CatalogueItem {
  id: string;
  kind: 'vector' | 'raster' | 'timeseries' | 'map' | 'document';
  title: string;
  abstract: string;
  managingUnit: string;
  isPublished: boolean;
  mine: boolean;
  variable: string | null;
  unit: string | null;
  timeSteps: string[] | null;
  bbox4326: [number, number, number, number] | null;
  /** GeoNode's `alternate`, e.g. geonode:ts_1a2b3c4d. */
  layerName: string;
}

interface ResourceRow {
  id: string;
  kind: CatalogueItem['kind'];
  title: string;
  abstract: string;
  managing_unit: string;
  is_published: boolean;
  owner_sub: string | null;
  variable: string | null;
  unit: string | null;
  time_steps: Date[] | null;
  bbox4326: number[] | null;
  alternate: string;
}

const COLS = `id, kind, title, abstract, managing_unit, is_published, owner_sub, variable, unit,
              time_steps, bbox4326::float8[] AS bbox4326, alternate`;

function toItem(row: ResourceRow, user: CurrentUser | undefined): CatalogueItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    abstract: row.abstract,
    managingUnit: row.managing_unit,
    isPublished: row.is_published,
    mine: isOwner(user, row),
    variable: row.variable,
    unit: row.unit,
    timeSteps: row.time_steps ? row.time_steps.map((d) => d.toISOString()) : null,
    bbox4326: row.bbox4326 ? (row.bbox4326.map(Number) as CatalogueItem['bbox4326']) : null,
    layerName: row.alternate,
  };
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

    /** One visible resource; one that is missing or not visible to the caller is the same 404. */
    async get(user: CurrentUser | undefined, id: string): Promise<CatalogueItem> {
      const { rows } = await pg.query<ResourceRow>(
        `SELECT ${COLS} FROM catalogue.resources WHERE id = $2 AND ${visibleSql(1)}`,
        [user?.oidcSubject ?? null, id]
      );
      if (!rows[0]) throw new NotFoundError(ITEM_NOT_FOUND);
      return toItem(rows[0], user);
    },
  };
}
