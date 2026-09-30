#!/usr/bin/env bash
# Publish the self-hosted basemap tables to GeoServer and build the layer group.
#
# Run AFTER load_basemap.py has populated the `basemap` schema in PostGIS.
# Idempotent and fail-closed: each resource is checked with a GET and created (POST) or updated
# (PUT); any status that is not 2xx stops the script, so a registry stage never records a failed
# publish as a success. The tile cache is truncated only after everything else succeeded.
#
# Env:
#   GEOSERVER_URL             default http://localhost:8080/geoserver
#   GEOSERVER_ADMIN_USER      default admin
#   GEOSERVER_ADMIN_PASSWORD  required (environment only, never argv)
#   GEOSERVER_WORKSPACE       default webatlas
#   GEOSERVER_DB_HOST/PORT/NAME/USER/PASSWORD  how GeoServer reaches PostGIS
#     (inside docker compose that is host=db, NOT localhost)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/geoserver.sh
. "$SCRIPT_DIR/../lib/geoserver.sh"

# Draw order matters: land at the bottom, roads above water, labels are
# DELIBERATELY ABSENT — the app draws its own province/ward labels, and the
# basemap this replaced was CARTO `light_nolabels` for exactly that reason.
LAYERS=(land_vn landuse_region water_region railways_vn roads_region roads_vn)
STYLES=(basemap_land basemap_landuse basemap_water basemap_railways basemap_roads_region basemap_roads_vn)

echo "== workspace and datastore"
gs_ensure_workspace
gs_ensure_basemap_store

echo "== feature types"
for t in "${LAYERS[@]}" places_vn places_region; do
  gs_ensure_featuretype "$BASEMAP_STORE" "$t" \
    "{\"featureType\":{\"name\":\"$t\",\"nativeName\":\"$t\",\"srs\":\"EPSG:4326\",\"enabled\":true}}"
done

published=""; styled=""
for i in "${!LAYERS[@]}"; do
  published="$published{\"@type\":\"layer\",\"name\":\"$WS:${LAYERS[$i]}\"},"
  styled="$styled{\"name\":\"$WS:${STYLES[$i]}\"},"
done
published="${published%,}"; styled="${styled%,}"
BODY="{\"layerGroup\":{\"name\":\"basemap\",\"mode\":\"SINGLE\",
  \"title\":\"WebATLAS self-hosted basemap (OSM/ODbL, no labels)\",
  \"workspace\":{\"name\":\"$WS\"},
  \"publishables\":{\"published\":[$published]},
  \"styles\":{\"style\":[$styled]},
  \"bounds\":{\"minx\":102.0,\"maxx\":117.9,\"miny\":8.0,\"maxy\":23.5,\"crs\":\"EPSG:4326\"}}}"

echo "== layer group 'basemap' (styles come from styles.py, run it before this script)"
if gs_exists "$GS/workspaces/$WS/layergroups/basemap"; then
  require_2xx layergroup "$(gs_curl -XPUT -H "Content-Type: application/json" "$GS/workspaces/$WS/layergroups/basemap" -d "$BODY")"
else
  require_2xx layergroup "$(gs_curl -XPOST -H "Content-Type: application/json" "$GS/workspaces/$WS/layergroups" -d "$BODY")"
fi

echo "== truncate stale tiles (style and group changes do not invalidate the cache)"
require_2xx truncate "$(gs_curl -XPOST -H "Content-Type: text/xml" \
  --data "<truncateLayer><layerName>$WS:basemap</layerName></truncateLayer>" \
  "$GEOSERVER_URL/gwc/rest/masstruncate")"
echo "Done."

echo
echo "Tile endpoint (what the frontend uses):"
echo "  \${GEOSERVER_URL}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
echo "    &LAYER=$WS:basemap&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=image/png"
echo "    &TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}"
