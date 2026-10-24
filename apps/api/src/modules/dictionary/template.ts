import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DictAttribute, DictFeatureType } from '@webatlas/shared';

/** The attributes an uploader fills in: stored as table columns and not retired, in `ord` order. */
function currentColumns(ft: DictFeatureType): DictAttribute[] {
  return ft.attributes.filter((a) => a.source === 'column' && !a.validTo);
}

/** Point layers carry lon/lat columns; every other geometry is given as WKT. */
function geometryColumns(ft: DictFeatureType): string[] {
  return ft.geometryType === 'Point' ? ['kinh_do', 'vi_do'] : ['wkt'];
}

/** RFC 4180: quote a cell only when it holds a comma, a quote or a line break. */
function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** An empty CSV template: UTF-8 BOM, one CRLF-terminated header row, no data rows. */
export function csvTemplate(ft: DictFeatureType): string {
  const header = [...currentColumns(ft).map((a) => a.name), ...geometryColumns(ft)];
  return `﻿${header.map(csvCell).join(',')}\r\n`;
}

// GeoPackage 1.3 core (OGC 12-128r18). The three gpkg_* tables use the DDL from the spec's annex.
const GPKG_APPLICATION_ID = 0x47504b47; // "GPKG"
const GPKG_USER_VERSION = 10300;
const WGS84_WKT =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],' +
  'AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],' +
  'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';

const GPKG_DDL = `
CREATE TABLE gpkg_spatial_ref_sys (
  srs_name TEXT NOT NULL,
  srs_id INTEGER NOT NULL PRIMARY KEY,
  organization TEXT NOT NULL,
  organization_coordsys_id INTEGER NOT NULL,
  definition TEXT NOT NULL,
  description TEXT
);
CREATE TABLE gpkg_contents (
  table_name TEXT NOT NULL PRIMARY KEY,
  data_type TEXT NOT NULL,
  identifier TEXT UNIQUE,
  description TEXT DEFAULT '',
  last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  min_x DOUBLE,
  min_y DOUBLE,
  max_x DOUBLE,
  max_y DOUBLE,
  srs_id INTEGER,
  CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
);
CREATE TABLE gpkg_geometry_columns (
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  geometry_type_name TEXT NOT NULL,
  srs_id INTEGER NOT NULL,
  z TINYINT NOT NULL,
  m TINYINT NOT NULL,
  CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
  CONSTRAINT uk_gc_table_name UNIQUE (table_name),
  CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
  CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
);
INSERT INTO gpkg_spatial_ref_sys VALUES
  ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system'),
  ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system'),
  ('WGS 84 geodetic', 4326, 'EPSG', 4326, '${WGS84_WKT}', 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid');
`;

function sqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `number` is REAL; `text`, `code` and `date` are TEXT (dates as ISO 8601 strings, per the GeoPackage spec). */
function sqlType(a: DictAttribute): 'REAL' | 'TEXT' {
  return a.valueType === 'number' ? 'REAL' : 'TEXT';
}

/**
 * An empty GeoPackage 1.3 template: the core tables, the feature table named after the layer key with
 * `fid`, `geom` and one column per current column attribute, and no rows. `node:sqlite` is imported
 * lazily so only template requests pay its one-per-process ExperimentalWarning.
 */
export async function gpkgTemplate(ft: DictFeatureType): Promise<Buffer> {
  const { DatabaseSync } = await import('node:sqlite');
  const geometryType = (ft.geometryType ?? 'Geometry').toUpperCase();
  const table = sqlIdent(ft.key);
  const columns = [
    'fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL',
    `geom ${geometryType}`,
    ...currentColumns(ft).map((a) => `${sqlIdent(a.name)} ${sqlType(a)}`),
  ];

  const path = join(tmpdir(), `webatlas-template-${randomUUID()}.gpkg`);
  try {
    const db = new DatabaseSync(path);
    try {
      db.exec(`PRAGMA application_id = ${GPKG_APPLICATION_ID}; PRAGMA user_version = ${GPKG_USER_VERSION};`);
      db.exec('BEGIN');
      db.exec(GPKG_DDL);
      db.exec(`CREATE TABLE ${table} (${columns.join(', ')})`);
      db.prepare(
        `INSERT INTO gpkg_contents (table_name, data_type, identifier, description, srs_id)
         VALUES (?, 'features', ?, ?, 4326)`,
      ).run(ft.key, ft.key, ft.name);
      db.prepare(
        `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
         VALUES (?, 'geom', ?, 4326, 0, 0)`,
      ).run(ft.key, geometryType);
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    return await readFile(path);
  } finally {
    // Remove exactly this one file; it may not exist if opening the database failed.
    await unlink(path).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  }
}
