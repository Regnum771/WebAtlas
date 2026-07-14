/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('postgis', { ifNotExists: true });
  pgm.createSchema('app', { ifNotExists: true });
  pgm.createSchema('water', { ifNotExists: true });
  pgm.createExtension('citext', { ifNotExists: true });

  pgm.createType({ schema: 'app', name: 'user_role' }, ['admin', 'editor', 'viewer']);
  pgm.createType({ schema: 'app', name: 'audit_action' }, ['create', 'update', 'delete']);

  pgm.createTable(
    { schema: 'app', name: 'users' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      email: { type: 'citext', notNull: true, unique: true },
      password_hash: { type: 'text', notNull: true },
      full_name: { type: 'text' },
      role: { type: 'app.user_role', notNull: true, default: 'viewer' },
      is_active: { type: 'boolean', notNull: true, default: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );

  pgm.createTable(
    { schema: 'app', name: 'audit_log' },
    {
      id: { type: 'bigserial', primaryKey: true },
      user_id: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
      action: { type: 'app.audit_action', notNull: true },
      table_name: { type: 'text', notNull: true },
      feature_id: { type: 'uuid' },
      before: { type: 'jsonb' },
      after: { type: 'jsonb' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );
  pgm.createIndex({ schema: 'app', name: 'audit_log' }, 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'app', name: 'audit_log' });
  pgm.dropTable({ schema: 'app', name: 'users' });
  pgm.dropType({ schema: 'app', name: 'audit_action' });
  pgm.dropType({ schema: 'app', name: 'user_role' });
};
