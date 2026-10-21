import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { openDraft } from '@webatlas/versioning';
import { getPool, closePool } from '../../db/pool';
import { getLayer } from '../../layers/registry';
import { activeRelation, editCopyRowsArgs } from './repository';

afterAll(async () => {
  await closePool();
});

describe('edit-copy read through workspace.edit_copy_rows', () => {
  it('the SQL function and the registry agree for every editable layer', async () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      const def = getLayer(key);
      const args = editCopyRowsArgs(def, randomUUID());
      expect(args).toEqual({
        table: def.table,
        relation: activeRelation(def),
        geomColumn: def.geomColumn,
        columns: def.attributeColumns,
      });
    }

    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      const { rows: u } = await c.query<{ id: string }>(
        `INSERT INTO app.users (email, password_hash, role)
         VALUES ('p3b-editcopyrows-owner@webatlas.test', 'x', 'viewer') RETURNING id::text AS id`
      );
      const def = getLayer('dams');
      const draft = await openDraft(c, def.key, u[0].id);
      const a = editCopyRowsArgs(def, draft.id);
      const { rows } = await c.query<{ id: string }>(
        `SELECT id FROM workspace.edit_copy_rows($1::regclass, $2::regclass, $3, $4, $5::text[])`,
        [a.table, a.relation, draft.id, a.geomColumn, a.columns]
      );
      const { rows: active } = await c.query<{ id: string }>(`SELECT id::text AS id FROM water.dams_active`);
      expect(rows.map((r) => r.id).sort()).toEqual(active.map((r) => r.id).sort());
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
