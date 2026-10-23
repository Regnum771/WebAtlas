import type { Pool, PoolClient } from 'pg';
import { ZodDefault, ZodNullable, ZodNumber, ZodOptional, type ZodTypeAny } from 'zod';
import { NotFoundError, ValidationError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import { getLayer, type LayerDef } from '../../layers/registry';
import type { CurrentUser } from '../../types/fastify';
import { editCopyQuerySource } from '../layers/repository';
import { assertCanRead } from './access';
import { draftOf } from './editCopies';
import { LAYER_NOT_FOUND, UNSUPPORTED_KIND, type FieldDef } from './freeLayers';
import { compileQuery, type Column, type LayerQueryBody } from './layerQuery';
import type { LayerKind } from './maps';

/*
 * The layer table (spec 2026-10-24 section 2): one query answers the table of any personal layer
 * that has features. Each kind is wrapped as the same row shape, a CTE `r(id, properties, geom)`:
 * - a free layer (drawn or imported): its rows in workspace.features;
 * - an edit copy: workspace.edit_copy_rows, the official rows with the draft's changes on top
 *   (layers/repository.ts editCopyQuerySource, since it names the base table).
 * compileQuery (layerQuery.ts) turns the table's filter and sort into fragments over `r`; this file
 * runs them, with the counts, the page and the located feature's position, in one statement.
 */

export const QUERY_TIMEOUT = 'Bộ lọc mất quá nhiều thời gian; hãy thu hẹp điều kiện.';
/** Postgres query_canceled: what statement_timeout raises. */
const QUERY_CANCELED = '57014';
const STATEMENT_TIMEOUT = '5s';

/** An imported layer's columns are read from its first rows, by id. */
const SAMPLE_ROWS = 5000;
const MAX_COLUMNS = 200;

export interface TableRow {
  id: string;
  properties: Record<string, unknown>;
  bbox: [number, number, number, number] | null;
}
export interface TableAnswer {
  columns: Column[];
  total: number;
  matched: number;
  rows: TableRow[];
  position: number | null;
}

interface LayerRow {
  id: string;
  kind: LayerKind;
  fields: FieldDef[] | null;
  layerKey: string | null;
  draftId: string | null;
}

/** A source: SQL defining the CTE `r(id, properties, geom)`, with its own parameters from $1. */
interface Source {
  with: string;
  params: unknown[];
}

/** A free layer's rows. `r` is inlined: each read of it is an index scan on layer_id or id. */
function freeLayerSource(layerId: string): Source {
  return {
    with: `r AS NOT MATERIALIZED (SELECT id, properties, geom FROM workspace.features WHERE layer_id = $1)`,
    params: [layerId],
  };
}

/**
 * An imported layer's columns: the keys of its first rows (by id), at most MAX_COLUMNS, sorted
 * by name character by character. A key is a number column when every non-null value seen is a
 * JSON number; a key with only nulls is text.
 */
async function inferredColumns(client: PoolClient, layerId: string): Promise<Column[]> {
  const { rows } = await client.query<{ name: string; numeric: boolean | null }>(
    `SELECT e.key AS name,
            bool_and(jsonb_typeof(e.value) = 'number') FILTER (WHERE jsonb_typeof(e.value) <> 'null') AS numeric
       FROM (SELECT properties FROM workspace.features
              WHERE layer_id = $1 AND jsonb_typeof(properties) = 'object'
              ORDER BY id LIMIT ${SAMPLE_ROWS}) f
       CROSS JOIN LATERAL jsonb_each(f.properties) e
      GROUP BY e.key
      ORDER BY e.key COLLATE "C"
      LIMIT ${MAX_COLUMNS}`,
    [layerId]
  );
  return rows.map((r) => ({ name: r.name, type: r.numeric === true ? 'number' : 'text' }));
}

/** The zod type under optional / nullable / default wrappers. */
function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let s = schema;
  while (s instanceof ZodOptional || s instanceof ZodNullable || s instanceof ZodDefault) {
    s = s._def.innerType as ZodTypeAny;
  }
  return s;
}

/** An edit copy's columns: the registry's attribute columns, numbers where the schema says so. */
function editCopyColumns(def: LayerDef): Column[] {
  const shape = def.attributeSchema.shape as Record<string, ZodTypeAny>;
  return def.attributeColumns.map((name) => ({
    name,
    type: unwrap(shape[name]) instanceof ZodNumber ? 'number' : 'text',
  }));
}

export function layerTableService(pg: Pool) {
  return {
    /**
     * One page of a layer's table: its columns, the row counts before and after the filter, the
     * page's rows with their bbox, and the `locate` feature's zero-based position in the filtered,
     * sorted list (null when filtered out or not asked for). Readable by the owner and recipients.
     */
    async query(user: CurrentUser, mapId: string, layerId: string, body: LayerQueryBody): Promise<TableAnswer> {
      await assertCanRead(pg, mapId, user);
      try {
        return await inTransaction(pg, async (client) => {
          // One snapshot for the layer row and its rows; the whole read is bounded in time.
          await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
          await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
          const { rows: layers } = await client.query<LayerRow>(
            `SELECT id, kind, fields, layer_key AS "layerKey", draft_id AS "draftId"
               FROM workspace.map_layers WHERE id = $1 AND map_id = $2`,
            [layerId, mapId]
          );
          const layer = layers[0];
          if (!layer) throw new NotFoundError(LAYER_NOT_FOUND);

          let columns: Column[];
          let source: Source;
          if (layer.kind === 'free') {
            const fields = layer.fields ?? [];
            columns = fields.length > 0 ? fields.map((f) => ({ name: f.name, type: f.type })) : await inferredColumns(client, layerId);
            source = freeLayerSource(layerId);
          } else if (layer.kind === 'edit_copy') {
            const draftId = draftOf({ id: layer.id, layerKey: layer.layerKey!, draftId: layer.draftId });
            const def = getLayer(layer.layerKey!);
            columns = editCopyColumns(def);
            source = editCopyQuerySource(def, draftId, 1);
          } else {
            throw new ValidationError(UNSUPPORTED_KIND);
          }
          return { columns, ...(await runQuery(client, source, columns, body)) };
        });
      } catch (e) {
        if ((e as { code?: unknown }).code === QUERY_CANCELED) throw new ValidationError(QUERY_TIMEOUT);
        throw e;
      }
    },
  };
}

/**
 * The counts, the page and the position in one statement. The sort key's parameters follow the
 * filter's in compileQuery's single list, so both fragments run in this statement and nowhere
 * else. `f` holds only the matching ids and their positions; the page joins back to `r` for the
 * properties and the geometry of its own rows only.
 */
async function runQuery(
  client: PoolClient, source: Source, columns: Column[], body: LayerQueryBody
): Promise<Omit<TableAnswer, 'columns'>> {
  const compiled = compileQuery(columns, body, source.params.length + 1);
  const params = [...source.params, ...compiled.params];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const offset = bind(body.offset);
  const limit = bind(body.limit);
  const locate = bind(body.locate ?? null);
  const { rows } = await client.query<Omit<TableAnswer, 'columns'>>(
    `WITH ${source.with},
     f AS (
       SELECT r.id, row_number() OVER (ORDER BY ${compiled.orderBy}) - 1 AS pos
         FROM r
        WHERE ${compiled.where}
     ),
     page AS (SELECT f.id, f.pos FROM f ORDER BY f.pos OFFSET ${offset}::bigint LIMIT ${limit}::bigint)
     SELECT (SELECT count(*)::int FROM r) AS total,
            (SELECT count(*)::int FROM f) AS matched,
            (SELECT f.pos::int FROM f WHERE f.id::text = ${locate}::text) AS position,
            (SELECT COALESCE(json_agg(json_build_object(
                      'id', r.id::text,
                      'properties', r.properties,
                      'bbox', CASE WHEN r.geom IS NULL OR ST_IsEmpty(r.geom) THEN NULL
                                   ELSE json_build_array(ST_XMin(r.geom), ST_YMin(r.geom), ST_XMax(r.geom), ST_YMax(r.geom))
                              END
                    ) ORDER BY p.pos), '[]'::json)
               FROM page p JOIN r ON r.id = p.id) AS rows`,
    params
  );
  return rows[0];
}
