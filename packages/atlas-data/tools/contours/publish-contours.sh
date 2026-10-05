#!/usr/bin/env bash
# Publish one feature type per contour interval, each a SQL view over basemap.contours
# filtered to its own interval_m, then truncate the tile cache.
#
# Run after `npm run contours:generate -w @webatlas/api`. Styles first: styles.py.
#
# With the optional first argument `seed` it publishes nothing and instead starts a background GWC
# seed of the working region: contours_250 zooms 5-8, contours_100 zooms 9-10, contours_50 zooms
# 11-12 (default style only). Seeding is separate from the truncate above so the publish stage stays
# a pure publish-and-truncate; GWC runs the tasks, so the build does not wait for them.
#
# Env:
#   GEOSERVER_URL             default http://localhost:8080/geoserver
#   GEOSERVER_ADMIN_USER      default admin
#   GEOSERVER_ADMIN_PASSWORD  required (environment only, never argv)
#   CONTOUR_STORE             default basemap_pg (the PostGIS store over schema `basemap`)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/geoserver.sh
. "$SCRIPT_DIR/../lib/geoserver.sh"
STORE="${CONTOUR_STORE:-$BASEMAP_STORE}"

if [ "${1:-}" = seed ]; then
  echo "== seed tile caches over the working region (runs in the background)"
  gs_seed_region contours_250 5 8
  gs_seed_region contours_100 9 10
  gs_seed_region contours_50 11 12
  echo "Done."
  exit 0
fi

echo "== workspace and datastore"
gs_ensure_workspace
gs_ensure_basemap_store

# Never hand-copy the interval list: styles.py parses it from
# packages/shared/src/contours.ts (same source the data generator and the browser use),
# and we shell out to it here because bash cannot import TS itself. Fails loudly (set -e)
# if styles.py's own parse dies, and again below if it somehow prints nothing.
INTERVALS="$(python3 "$SCRIPT_DIR/styles.py" --print-intervals)"
if [ -z "$INTERVALS" ]; then
  echo "ERROR: packages/shared/src/contours.ts yielded no CONTOUR_INTERVALS — refusing to publish" >&2
  exit 1
fi
echo "== intervals from packages/shared/src/contours.ts: $INTERVALS"

for INTERVAL in $INTERVALS; do
  NAME="contours_${INTERVAL}"
  echo "== ${NAME}"
  # A SQL view, not the whole table: each published layer serves one bucket, so the
  # client never has to pass a filter and GWC can cache the result.
  BODY=$(cat <<XML
<featureType>
  <name>${NAME}</name>
  <nativeName>${NAME}</nativeName>
  <srs>EPSG:4326</srs>
  <metadata>
    <entry key="JDBC_VIRTUAL_TABLE">
      <virtualTable>
        <name>${NAME}</name>
        <sql>SELECT id, elevation_m, is_index, geom FROM basemap.contours WHERE interval_m = ${INTERVAL}</sql>
        <keyColumn>id</keyColumn>
        <geometry>
          <name>geom</name>
          <type>MultiLineString</type>
          <srid>4326</srid>
        </geometry>
      </virtualTable>
    </entry>
  </metadata>
</featureType>
XML
)
  gs_ensure_featuretype "$STORE" "$NAME" "$BODY" "text/xml"

  # Default style plain; labelled offered as an alternate so GWC caches both. Style names
  # are workspace-qualified (webatlas:...) so this resolves even if a same-named style
  # ever exists in another workspace.
  style_code=$(gs_curl -XPUT -H "Content-Type: text/xml" \
    "$GS/layers/$WS:$NAME" -d \
    "<layer><defaultStyle><name>$WS:contours_plain</name></defaultStyle>
       <styles><style><name>$WS:contours_labelled</name></style></styles></layer>")
  require_2xx style "$style_code"

  truncate_code=$(gs_curl -XPOST -H "Content-Type: text/xml" \
    --data "<truncateLayer><layerName>$WS:$NAME</layerName></truncateLayer>" \
    "${GEOSERVER_URL}/gwc/rest/masstruncate")
  require_2xx truncate "$truncate_code"
done
echo "Done."
