# Fail-closed GeoServer REST helpers shared by the tools' publish scripts. Sourced, never run.
# Every call prints only the HTTP status; any unexpected status stops the calling script.

GEOSERVER_URL="${GEOSERVER_URL:-http://localhost:8080/geoserver}"
GS="${GEOSERVER_URL}/rest"
WS="${GEOSERVER_WORKSPACE:-webatlas}"
BASEMAP_STORE="basemap_pg"
AUTH="${GEOSERVER_ADMIN_USER:-admin}:${GEOSERVER_ADMIN_PASSWORD:?set GEOSERVER_ADMIN_PASSWORD (read from the environment, never argv)}"

# curl printing only the status code. A transport failure prints 000 rather than aborting here,
# so the caller's require_2xx reports it with its label.
gs_curl() { curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" "$@" || true; }

require_2xx() {
  local label="$1" code="$2"
  echo "   ${label}: ${code}"
  case "$code" in
    2??) ;;
    *) echo "ERROR: ${label} returned ${code}, expected 2xx" >&2; exit 1 ;;
  esac
}

# 0 when the resource exists (200), 1 when it does not (404). Anything else — 401, 500, 000 — stops
# the script: treating an error as "missing" would POST blindly and hide the real cause.
gs_exists() {
  local code
  code=$(gs_curl "$1")
  case "$code" in
    200) return 0 ;;
    404) return 1 ;;
    *) echo "ERROR: GET $1 returned ${code}" >&2; exit 1 ;;
  esac
}

gs_ensure_workspace() {
  if ! gs_exists "$GS/workspaces/$WS"; then
    require_2xx workspace "$(gs_curl -XPOST -H "Content-Type: application/json" "$GS/workspaces" \
      -d "{\"workspace\":{\"name\":\"$WS\"}}")"
  fi
}

# The PostGIS store over the `basemap` schema. Both the basemap and the contours read from it, so each
# ensures it rather than one depending on the other having run.
gs_ensure_basemap_store() {
  if gs_exists "$GS/workspaces/$WS/datastores/$BASEMAP_STORE"; then return 0; fi
  require_2xx datastore "$(gs_curl -XPOST -H "Content-Type: application/json" "$GS/workspaces/$WS/datastores" -d "{
  \"dataStore\":{\"name\":\"$BASEMAP_STORE\",\"connectionParameters\":{\"entry\":[
    {\"@key\":\"dbtype\",\"\$\":\"postgis\"},{\"@key\":\"host\",\"\$\":\"${GEOSERVER_DB_HOST:-db}\"},
    {\"@key\":\"port\",\"\$\":\"${GEOSERVER_DB_PORT:-5432}\"},{\"@key\":\"database\",\"\$\":\"${GEOSERVER_DB_NAME:-webatlas}\"},
    {\"@key\":\"schema\",\"\$\":\"basemap\"},{\"@key\":\"user\",\"\$\":\"${GEOSERVER_DB_USER:-webatlas}\"},
    {\"@key\":\"passwd\",\"\$\":\"${GEOSERVER_DB_PASSWORD:-}\"},{\"@key\":\"Expose primary keys\",\"\$\":\"true\"},
    {\"@key\":\"Loose bbox\",\"\$\":\"true\"}]}}}")"
}

# gs_ensure_featuretype <store> <name> <body> [content-type]: create, or PUT onto an existing one.
gs_ensure_featuretype() {
  local store="$1" name="$2" body="$3" ctype="${4:-application/json}"
  local path="$GS/workspaces/$WS/datastores/$store/featuretypes"
  if gs_exists "$path/$name"; then
    require_2xx "featuretype $name" "$(gs_curl -XPUT -H "Content-Type: $ctype" "$path/$name" -d "$body")"
  else
    require_2xx "featuretype $name" "$(gs_curl -XPOST -H "Content-Type: $ctype" "$path" -d "$body")"
  fi
}
