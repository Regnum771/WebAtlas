#!/usr/bin/env bash
# Publish the self-hosted basemap tables to GeoServer and build the layer group.
#
# Run AFTER load_basemap.py has populated the `basemap` schema in PostGIS.
# Idempotent: re-running is safe (creates return 201, "already exists" returns
# 401/500 which we tolerate; the layer group is PUT, not POSTed, on retry).
#
# Env:
#   GEOSERVER_URL             default http://localhost:8080/geoserver
#   GEOSERVER_ADMIN_USER      default admin
#   GEOSERVER_ADMIN_PASSWORD  required
#   GEOSERVER_WORKSPACE       default webatlas
#   GEOSERVER_DB_HOST/PORT/NAME/USER/PASSWORD  how GeoServer reaches PostGIS
#     (inside docker compose that is host=db, NOT localhost)
set -uo pipefail

GS="${GEOSERVER_URL:-http://localhost:8080/geoserver}/rest"
WS="${GEOSERVER_WORKSPACE:-webatlas}"
USER="${GEOSERVER_ADMIN_USER:-admin}"
PW="${GEOSERVER_ADMIN_PASSWORD:?set GEOSERVER_ADMIN_PASSWORD}"
AUTH="$USER:$PW"
STORE="basemap_pg"

DB_HOST="${GEOSERVER_DB_HOST:-db}"
DB_PORT="${GEOSERVER_DB_PORT:-5432}"
DB_NAME="${GEOSERVER_DB_NAME:-webatlas}"
DB_USER="${GEOSERVER_DB_USER:-webatlas}"
DB_PW="${GEOSERVER_DB_PASSWORD:-change_me_dev}"

# Draw order matters: land at the bottom, roads above water, labels are
# DELIBERATELY ABSENT — the app draws its own province/ward labels, and the
# basemap this replaced was CARTO `light_nolabels` for exactly that reason.
LAYERS=(land_vn landuse_region water_region railways_vn roads_region roads_vn)
STYLES=(basemap_land basemap_landuse basemap_water basemap_railways basemap_roads_region basemap_roads_vn)

echo "== datastore -> schema 'basemap'"
curl -s -o /dev/null -w "   datastore: %{http_code}\n" -u "$AUTH" -XPOST \
  -H "Content-Type: application/json" "$GS/workspaces/$WS/datastores" -d "{
  \"dataStore\":{\"name\":\"$STORE\",\"connectionParameters\":{\"entry\":[
    {\"@key\":\"dbtype\",\"\$\":\"postgis\"},{\"@key\":\"host\",\"\$\":\"$DB_HOST\"},
    {\"@key\":\"port\",\"\$\":\"$DB_PORT\"},{\"@key\":\"database\",\"\$\":\"$DB_NAME\"},
    {\"@key\":\"schema\",\"\$\":\"basemap\"},{\"@key\":\"user\",\"\$\":\"$DB_USER\"},
    {\"@key\":\"passwd\",\"\$\":\"$DB_PW\"},{\"@key\":\"Expose primary keys\",\"\$\":\"true\"},
    {\"@key\":\"Loose bbox\",\"\$\":\"true\"}]}}}"

echo "== publish feature types"
for t in "${LAYERS[@]}" places_vn places_region; do
  printf "   %-16s " "$t"
  curl -s -o /dev/null -w "%{http_code}\n" -u "$AUTH" -XPOST -H "Content-Type: application/json" \
    "$GS/workspaces/$WS/datastores/$STORE/featuretypes" \
    -d "{\"featureType\":{\"name\":\"$t\",\"nativeName\":\"$t\",\"srs\":\"EPSG:4326\",\"enabled\":true}}"
done

echo "== styles (see styles.py, run it before this script)"

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

echo "== layer group 'basemap'"
code=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -XPOST -H "Content-Type: application/json" \
  "$GS/workspaces/$WS/layergroups" -d "$BODY")
if [ "$code" != "201" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -XPUT -H "Content-Type: application/json" \
    "$GS/workspaces/$WS/layergroups/basemap" -d "$BODY")
fi
echo "   layergroup: $code"

echo "== truncate stale tiles (styles/group changes do NOT auto-invalidate the cache)"
curl -s -o /dev/null -w "   truncate: %{http_code}\n" -u "$AUTH" -XPOST -H "Content-Type: text/xml" \
  --data "<truncateLayer><layerName>$WS:basemap</layerName></truncateLayer>" \
  "${GEOSERVER_URL:-http://localhost:8080/geoserver}/gwc/rest/masstruncate"

echo
echo "Tile endpoint (what the frontend uses):"
echo "  \${GEOSERVER_URL}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
echo "    &LAYER=$WS:basemap&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=image/png"
echo "    &TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}"
