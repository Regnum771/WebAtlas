#!/usr/bin/env bash
# Publish the self-hosted basemap tables to GeoServer and build its layer groups.
#
# Run AFTER load_basemap.py has populated the `basemap` schema in PostGIS.
# Three modes, chosen by one required argument. On a fresh GeoServer neither step can come first in
# one go: the styles need the feature types, and the layer group needs the styles. The registry runs
#   publish-basemap.sh featuretypes   ->   styles.py   ->   publish-basemap.sh group   ->   publish-basemap.sh seed
#   featuretypes  ensure workspace, basemap_pg store and every feature type (no group, no truncate)
#   group         create or PUT the five layer groups the web app requests, then truncate their tile caches
#   seed          start a background GWC seed of the working region (zooms 5-12) for the five groups.
#                 Separate from `group` so that stage stays a pure publish-and-truncate; GWC runs the
#                 tasks, so the build does not wait for them and returns once they are accepted.
#
# Idempotent and fail-closed: each resource is checked with a GET and created (POST) or updated
# (PUT); any status that is not 2xx stops the script, so a registry stage never records a failed
# publish as a success. The tile cache is truncated only after everything else succeeded.
#
# Env:
#   GEOSERVER_URL             default http://localhost:8080/geoserver
#   GEOSERVER_ADMIN_USER      default admin
#   GEOSERVER_ADMIN_PASSWORD  required (environment only, never argv)
#   GEOSERVER_WORKSPACE       default webatlas
#   GEOSERVER_DB_PASSWORD     required when the store has to be created
#   GEOSERVER_DB_HOST/PORT/NAME/USER  how GeoServer reaches PostGIS
#     (inside docker compose that is host=db, NOT localhost)
set -euo pipefail
MODE="${1:-}"
case "$MODE" in
  featuretypes|group|seed) ;;
  *) echo "usage: publish-basemap.sh <featuretypes|group|seed>" >&2; exit 2 ;;
esac
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/geoserver.sh
. "$SCRIPT_DIR/../lib/geoserver.sh"

# Feature types to publish. The two place tables are published for their styles, in no group:
# labels are DELIBERATELY ABSENT from the basemap — the app draws its own province/ward labels, and
# the basemap this replaced was CARTO `light_nolabels` for exactly that reason.
TABLES=(land_vn landuse_region water_region railways_vn roads_region roads_vn places_vn places_region)

# The layer groups apps/web requests from GWC (MapModel.ts), as  name|title|layer:style[,layer:style].
# The base is land only. Each context layer is its own group so it can be toggled on its own and
# keeps its own tile cache; a composite base would draw them twice and make the toggles do nothing.
# Within a group, draw order is list order (bottom first).
LAYER_GROUPS=(
  "basemap|WebATLAS self-hosted basemap: land (OSM/ODbL, no labels)|land_vn:basemap_land"
  "bm_landuse|Basemap land use (OSM)|landuse_region:basemap_landuse"
  "bm_water|Basemap water areas (OSM)|water_region:basemap_water"
  "bm_railways|Basemap railways (OSM)|railways_vn:basemap_railways"
  "basemap_roads|Basemap roads (OSM)|roads_region:basemap_roads_region,roads_vn:basemap_roads_vn"
)
# Identical national bounds on every group. Load-bearing: OpenLayers requests tiles on the national
# grid, and a group published with its own tighter bbox answers 400 TileOutOfRange outside it.
BOUNDS='{"minx":102.0,"maxx":117.9,"miny":8.0,"maxy":23.5,"crs":"EPSG:4326"}'

if [ "$MODE" = seed ]; then
  echo "== seed tile caches over the working region (zooms 5-12, runs in the background)"
  for entry in "${LAYER_GROUPS[@]}"; do
    gs_seed_region "${entry%%|*}" 5 12
  done
  echo "Done."
  exit 0
fi

if [ "$MODE" = featuretypes ]; then
  echo "== workspace and datastore"
  gs_ensure_workspace
  gs_ensure_basemap_store

  echo "== feature types"
  for t in "${TABLES[@]}"; do
    gs_ensure_featuretype "$BASEMAP_STORE" "$t" \
      "{\"featureType\":{\"name\":\"$t\",\"nativeName\":\"$t\",\"srs\":\"EPSG:4326\",\"enabled\":true}}"
  done
  echo "Done."
  exit 0
fi

# GeoServer accepts a group that names a missing style (2xx) and then draws that layer unstyled, so
# every style is checked before anything is written.
echo "== styles (from styles.py, run it before this script)"
for entry in "${LAYER_GROUPS[@]}"; do
  IFS='|' read -r _ _ members <<<"$entry"
  IFS=',' read -ra pairs <<<"$members"
  for pair in "${pairs[@]}"; do
    style="${pair#*:}"
    # .json on purpose: without an extension GeoServer answers 500 for a style, existing or not.
    if ! gs_exists "$GS/workspaces/$WS/styles/$style.json"; then
      echo "ERROR: style $WS:$style does not exist; run styles.py before publish-basemap.sh group" >&2
      exit 1
    fi
  done
done

echo "== layer groups"
names=()
for entry in "${LAYER_GROUPS[@]}"; do
  IFS='|' read -r name title members <<<"$entry"
  IFS=',' read -ra pairs <<<"$members"
  published=""; styled=""
  for pair in "${pairs[@]}"; do
    published="$published{\"@type\":\"layer\",\"name\":\"$WS:${pair%%:*}\"},"
    styled="$styled{\"name\":\"$WS:${pair#*:}\"},"
  done
  body="{\"layerGroup\":{\"name\":\"$name\",\"mode\":\"SINGLE\",\"title\":\"$title\",
  \"workspace\":{\"name\":\"$WS\"},
  \"publishables\":{\"published\":[${published%,}]},
  \"styles\":{\"style\":[${styled%,}]},
  \"bounds\":$BOUNDS}}"
  if gs_exists "$GS/workspaces/$WS/layergroups/$name"; then
    require_2xx "layergroup $name" "$(gs_curl -XPUT -H "Content-Type: application/json" "$GS/workspaces/$WS/layergroups/$name" -d "$body")"
  else
    require_2xx "layergroup $name" "$(gs_curl -XPOST -H "Content-Type: application/json" "$GS/workspaces/$WS/layergroups" -d "$body")"
  fi
  names+=("$name")
done

echo "== truncate stale tiles (style and group changes do not invalidate the cache)"
for name in "${names[@]}"; do
  require_2xx "truncate $name" "$(gs_curl -XPOST -H "Content-Type: text/xml" \
    --data "<truncateLayer><layerName>$WS:$name</layerName></truncateLayer>" \
    "$GEOSERVER_URL/gwc/rest/masstruncate")"
done
echo "Done."

echo
echo "Tile endpoint (what the frontend uses), with LAYER one of: ${names[*]}"
echo "  \${GEOSERVER_URL}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
echo "    &LAYER=$WS:<group>&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=image/png"
echo "    &TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}"
