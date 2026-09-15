#!/usr/bin/env bash
# Publish one feature type per contour interval, each a SQL view over basemap.contours
# filtered to its own interval_m, then truncate the tile cache.
#
# Run after `npm run contours:generate -w @webatlas/api`. Styles first: styles.py.
#
# Env:
#   GEOSERVER_URL             default http://localhost:8080/geoserver
#   GEOSERVER_ADMIN_USER      default admin
#   GEOSERVER_ADMIN_PASSWORD  required
#   CONTOUR_STORE             default basemap_pg (the PostGIS store over schema `basemap`)
set -euo pipefail

GEOSERVER_URL="${GEOSERVER_URL:-http://localhost:8080/geoserver}"
GS="${GEOSERVER_URL}/rest"
WS=webatlas
STORE="${CONTOUR_STORE:-basemap_pg}"
USER="${GEOSERVER_ADMIN_USER:-admin}"
AUTH="$USER:${GEOSERVER_ADMIN_PASSWORD:?set GEOSERVER_ADMIN_PASSWORD}"

for INTERVAL in 250 100 50; do
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
  code=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -XPOST -H "Content-Type: text/xml" \
    "$GS/workspaces/$WS/datastores/$STORE/featuretypes" -d "$BODY" || true)
  if [ "$code" = "500" ] || [ "$code" = "409" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -XPUT -H "Content-Type: text/xml" \
      "$GS/workspaces/$WS/datastores/$STORE/featuretypes/$NAME" -d "$BODY")
  fi
  echo "   featuretype: $code"

  # Default style plain; labelled offered as an alternate so GWC caches both.
  curl -s -o /dev/null -w "   style: %{http_code}\n" -u "$AUTH" -XPUT -H "Content-Type: text/xml" \
    "$GS/layers/$WS:$NAME" -d \
    "<layer><defaultStyle><name>contours_plain</name></defaultStyle>
       <styles><style><name>contours_labelled</name></style></styles></layer>"

  curl -s -o /dev/null -w "   truncate: %{http_code}\n" -u "$AUTH" -XPOST -H "Content-Type: text/xml" \
    --data "<truncateLayer><layerName>$WS:$NAME</layerName></truncateLayer>" \
    "${GEOSERVER_URL}/gwc/rest/masstruncate"
done
echo "Done."
