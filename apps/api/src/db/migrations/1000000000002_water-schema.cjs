/* eslint-disable camelcase */
exports.shorthands = undefined;

const COMMON = (pgm) => ({
  id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  created_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
  updated_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
});

function makeTable(pgm, name, geomType, columns) {
  pgm.createTable({ schema: 'water', name }, {
    ...COMMON(pgm),
    name: { type: 'text' },
    ...columns,
    geom: { type: `geometry(${geomType}, 4326)`, notNull: true },
  });
  pgm.createIndex({ schema: 'water', name }, 'geom', { method: 'gist' });
  pgm.createIndex({ schema: 'water', name }, 'external_id', { unique: true });
}

exports.up = (pgm) => {
  makeTable(pgm, 'dams', 'Point', {
    external_id: { type: 'integer' },
    name_en: { type: 'text' },
    wattage_mw: { type: 'numeric' },
    annual_output: { type: 'numeric' },
    year_launched: { type: 'text' },
    year_operational: { type: 'text' },
    status: { type: 'text' },
  });

  makeTable(pgm, 'rivers', 'MultiLineString', {
    external_id: { type: 'integer' },
    code: { type: 'text' },
    stream_order: { type: 'integer' },
    length_m: { type: 'numeric' },
  });

  makeTable(pgm, 'stations', 'Point', {
    external_id: { type: 'text' },
    station_type: { type: 'text' },
    status: { type: 'text' },
    value: { type: 'text' },
  });

  makeTable(pgm, 'flood_zones', 'MultiPolygon', {
    external_id: { type: 'text' },
    hazard_type: { type: 'text' },
    area: { type: 'text' },
    risk_level: { type: 'text' },
  });

  makeTable(pgm, 'drought_points', 'Point', {
    external_id: { type: 'text' },
    risk_level: { type: 'text' },
    status: { type: 'text' },
    survey_date: { type: 'date' },
  });

  makeTable(pgm, 'saltwater_intrusion', 'Point', {
    external_id: { type: 'text' },
    salinity: { type: 'text' },
    risk_level: { type: 'text' },
    status: { type: 'text' },
  });

  makeTable(pgm, 'flood_generation', 'MultiPolygon', {
    external_id: { type: 'text' },
    risk_level: { type: 'text' },
    area: { type: 'text' },
    flow_rate: { type: 'text' },
  });
};

exports.down = (pgm) => {
  for (const name of [
    'flood_generation', 'saltwater_intrusion', 'drought_points',
    'flood_zones', 'stations', 'rivers', 'dams',
  ]) {
    pgm.dropTable({ schema: 'water', name });
  }
};
