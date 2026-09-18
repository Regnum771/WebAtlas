/**
 * SQL expression turning a geometry column/expression into simplified GeoJSON for
 * drawing. Tolerance scales with the shape's own extent (≈ 1/2000 of its larger side),
 * so a 200 km river loses sub-pixel detail while a 50 m pond keeps its outline.
 * Points have zero extent → tolerance 0 → unchanged.
 *
 * `expr` must be a trusted column name or SQL expression, never tool input.
 */
export function simplifiedGeoJsonSql(expr: string): string {
  const tolerance = `GREATEST(ST_XMax(${expr}) - ST_XMin(${expr}), ST_YMax(${expr}) - ST_YMin(${expr})) / 2000.0`;
  return `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${expr}, ${tolerance}), 6)::json`;
}
