#!/usr/bin/env bash
# GeoFence rules for the `webatlas` workspace on GeoNode's GeoServer: anyone may read (the WebATLAS
# map is public, like it was on the standalone GeoServer), nobody but GeoServer admins may write
# through WFS. GeoFence's default is DENY, so without these rules the map goes blank.
# Idempotent: adds only the rules that are missing, then clears GeoFence's 5-minute decision cache.
#
#   GEOSERVER_URL=http://localhost:8080/geoserver GEOSERVER_ADMIN_USER=admin \
#   GEOSERVER_ADMIN_PASSWORD=... bash infra/platform/geoserver/webatlas-access.sh
set -euo pipefail

GS="${GEOSERVER_URL:-http://localhost:8080/geoserver}"
AUTH="${GEOSERVER_ADMIN_USER:-admin}:${GEOSERVER_ADMIN_PASSWORD:?GEOSERVER_ADMIN_PASSWORD is required}"
WS="${GEOSERVER_WORKSPACE:-webatlas}"

existing=$(curl -fsS -u "$AUTH" "$GS/rest/geofence/rules.json?workspace=$WS&page=0&entries=100")

has_rule() { # service request access
  python3 -I -c '
import json, sys
rules = json.loads(sys.argv[1]).get("rules", [])
want = tuple(None if v == "-" else v for v in sys.argv[2:5])
sys.exit(0 if any((r.get("service"), r.get("request"), r.get("access")) == want and not r.get("layer") and not r.get("userName") and not r.get("roleName") for r in rules) else 1)
' "$existing" "$1" "$2" "$3"
}

add_rule() { # priority service request access
  local svc=$1 req=$2
  [ "$svc" = "-" ] && svc=null || svc="\"$svc\""
  [ "$req" = "-" ] && req=null || req="\"$req\""
  curl -fsS -u "$AUTH" -o /dev/null -H 'Content-Type: application/json' -X POST "$GS/rest/geofence/rules" \
    -d "{\"Rule\":{\"priority\":$3,\"workspace\":\"$WS\",\"service\":$svc,\"request\":$req,\"access\":\"$4\"}}"
  echo "added: $WS ${1}/${2} $4"
}

# Lower priority numbers are checked first: the write denials come before the catch-all read.
for rule in "WFS TRANSACTION 1 DENY" "WFS LOCKFEATURE 2 DENY" "WFS GETFEATUREWITHLOCK 3 DENY" "- - 10 ALLOW"; do
  set -- $rule
  if has_rule "$1" "$2" "$4"; then echo "present: $WS $1/$2 $4"; else add_rule "$1" "$2" "$3" "$4"; fi
done

curl -fsS -u "$AUTH" -o /dev/null -X PUT "$GS/rest/ruleCache/invalidate"
echo "GeoFence cache invalidated"
