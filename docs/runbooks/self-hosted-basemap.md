# Runbook — self-hosted basemap

**Run this when:** the street basemap needs rebuilding, or you want fresher OpenStreetMap data under the map.

**How:** `npm run atlas:build -- --force basemap`. `npm run atlas:up` builds it on a fresh machine. The `basemap` dataset runs five stages, in this order: fetch the Geofabrik extract, `load_basemap.py <zip>`, `publish-basemap.sh featuretypes`, `styles.py`, `publish-basemap.sh group`. Every tool runs inside the `atlas-tools` image (Python geo stack, `psql`, GDAL), so nothing needs installing on the host.

The rendered tiles live in PostGIS + GeoServer, not in git. Nothing here needs to run for day-to-day development *provided* the `basemap` schema is already populated and the `webatlas:basemap` layer group exists on your GeoServer.

## Why this exists

The street basemap used to be CARTO `light_nolabels`. CARTO moved their basemaps behind an API key, and the old endpoint now returns **HTTP 200 with a grey tile reading "API KEY REQUIRED"** — broken without erroring, so nothing in the app noticed. Satellite and DEM (both Esri) were unaffected.

Re-hosting CARTO or Esri tiles is prohibited by their terms. So the street basemap is rebuilt from OpenStreetMap data we are licensed to host.

> **Licence: ODbL.** The basemap is derived from OpenStreetMap. The attribution
> "© OpenStreetMap contributors" is **required** wherever these tiles render. It is
> set on the tile source in `MapModel.ts` (`streetBasemapSource`). Do not remove it.

## Design: two tiers

Detail is scale-dependent, so the whole country is covered without loading the whole country in detail.

| Tier | Coverage | Layers | Rough scale |
|---|---|---|---|
| **Coarse** | All Vietnam | major roads (motorway/trunk/primary), railways, land | 1:13M → 1:400k |
| **Detailed** | 6 working-region provinces | all roads, landuse, water areas | 1:400k → 1:17k |

The region tier is clipped to the **province polygons**, not their bounding box: the bbox reaches lon 117.8° because Hoàng Sa and Trường Sa belong to Đà Nẵng and Khánh Hoà, so a bbox clip would drag in a vast area of sea.

**The basemap has no labels.** The app draws its own province and ward labels; adding basemap labels double-renders every place name. This mirrors the original `light_nolabels` choice.

**Context layers are separate, not composited.** Roads, railways, water and landuse are each their own GeoServer layer group with its own tile cache, and each appears as its own row under **Nền bản đồ** in the layers panel. Separation costs one HTTP request per layer per tile — it does **not** cost caching (each group caches independently) and toggling one off does not free its source, so re-enabling is instant from OpenLayers' own tile cache.

| Layer group | Panel row | Default |
|---|---|---|
| `webatlas:basemap` | *(base — land/sea, not toggleable)* | always on |
| `webatlas:basemap_roads` | Giao thông đường bộ | on |
| `webatlas:bm_railways` | Đường sắt | on |
| `webatlas:bm_water` | Mặt nước nền | on |
| `webatlas:bm_landuse` | Sử dụng đất | off |

Their ids live in `BASEMAP_CONTEXT_LAYER_STATE_IDS` (`packages/shared`), so `layerDisplay.ts`, `MapModel.ts` and `isMapCommand` all read one list — and they are deliberately valid command targets, so an assistant can be asked to turn the roads off.

**All groups are published with identical national bounds.** This is load-bearing: OpenLayers does not know each layer's extent, so if a group's bounds were its own tighter native bbox, OL would request tiles outside it and GWC would answer `400 TileOutOfRange`, leaving visible gaps.

## Rebuilding

```bash
npm run atlas:build -- --force basemap
```

`--force` is for a deliberate rebuild (for example a newer extract): without it a finished basemap is skipped. It also rebuilds `reference_entities`, which depends on `basemap` (see 3b). The stages below are what the dataset does, in order, and how to run one by hand inside the tools image:

```bash
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools <argv>
```

The GeoServer password reaches the scripts through the environment (from `infra/.env`, via the compose service), never as an argument.

### 1. Download the extract (~684 MB)

The registry fetches `https://download.geofabrik.de/asia/vietnam-latest-free.shp.zip` into `packages/atlas-data/data/cache/basemap/`. The URL is `latest`, so it is deliberately unpinned: the fetched file's hash is recorded in lineage, and `--force basemap` refreshes it.

Geofabrik, OpenStreetMap-derived, ODbL. **Do not unzip it** — the loader reads through GDAL's `/vsizip/`, so ~1.1 GB of shapefiles never hit disk.

### 2. Load into PostGIS

```bash
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
  python3 packages/atlas-data/tools/basemap/load_basemap.py packages/atlas-data/data/cache/basemap/vietnam-latest-free.shp.zip
```

The Python geo stack (`geopandas`, `shapely`, `pyproj`, `psycopg2-binary`, `geoalchemy2`) is in the tools image, pinned in `packages/atlas-data/tools/requirements.txt`; there is nothing to install. No system GDAL on the host either, which matters, because this repo has none.

Creates the `basemap` schema and 8 tables. Expect roughly:

| Table | Features |
|---|---|
| `roads_region` | ~527,000 |
| `roads_vn` | ~62,600 |
| `landuse_region` | ~12,100 |
| `places_region` | ~6,100 |
| `water_region` | ~5,800 |
| `railways_vn` | ~3,700 |
| `places_vn` | ~1,600 |
| `land_vn` | 34 |

`places_*` are loaded but **not** in the layer group — see "no labels" above.

### 3. Publish the feature types

```bash
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
  bash packages/atlas-data/tools/basemap/publish-basemap.sh featuretypes
```

Creates the datastore and publishes the feature types, so that styles have layers to attach to.

### 3b. Rebuild the dissolved reference entities

```bash
npm run atlas:build -- --only reference_entities
```

(the `reference_entities` dataset; it runs `npm run reference:build -w @webatlas/api`, which still works until Plan C.)

Step 2 loads every `basemap` table with GeoPandas `to_postgis(..., if_exists="replace")`, which **drops and
recreates** each table it touches. `basemap.reference_entities` — the dissolved, named, searchable roads, railways,
water bodies, land use and places that `GET /api/reference/*` and the `ref:*` sources on `GET /api/search` actually
read — is built from those raw tables by a separate script, not by the loader, and is therefore stale the moment
step 2 finishes: it can point at `osm_id`s that no longer exist and miss ones that now do. The registry runs it after
`basemap` for you (`dependsOn`); do it by hand only after loading the basemap outside the registry. See `docs/architecture/database-architecture.md` §10.2 for why
the search index lives on this derived table rather than on `roads_region` and friends.

The river hierarchy (`water.rivers`, built by the `rivers` dataset) is independent of all of this: it reads only
the committed OSM waterways and HydroRIVERS seeds, never a `basemap` table, so reloading the basemap or rebuilding
the reference entities neither requires nor invalidates a river re-ingest, and the two orderings do not interact.

### 4. Upload styles, then publish the layer group

```bash
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
  python3 packages/atlas-data/tools/basemap/styles.py
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
  bash packages/atlas-data/tools/basemap/publish-basemap.sh group
```

`styles.py` generates the SLDs (muted Positron-lineage palette, scale-dependent rules) and assigns them. `publish-basemap.sh group` builds the `webatlas:basemap` layer group and truncates the tile cache.

**Order matters:** feature types, then styles, then the group: `styles.py` assigns styles to layers that must already exist, and the layer group references styles that must exist first.

### 5. Verify

```bash
curl -s -o out.png "http://localhost:8080/geoserver/webatlas/wms?service=WMS&version=1.1.1\
&request=GetMap&layers=webatlas:basemap&srs=EPSG:4326&format=image/png\
&bbox=107.2,11.0,109.6,16.2&width=400&height=800&bgcolor=0xDCE7EF&transparent=false"
```

Open it. Land should be near-white on a pale blue sea, with the coastal highway visible. A blank image means the layer group is empty or the styles failed to assign.

## Gotchas

- **Changing a style or the layer group does not invalidate cached tiles.** You will keep seeing the old render until you truncate — `publish-basemap.sh` does this at the end. If a style change seems to do nothing, this is why.
- **WMTS rows are top-origin; TMS rows are bottom-origin.** `WMTS row = (2^z − 1) − TMS row`. Mixing them gives `TileOutOfRange`. OpenLayers' `XYZ` source uses top-origin, matching WMTS.
- **GeoServer connects to PostGIS as `host=db`**, the compose service name — not `localhost`. `localhost` inside the container is the container itself.
- **Label priority.** `places_*` styles rank labels by `population`, otherwise GeoServer resolves collisions by row order and drops Hà Nội in favour of whichever small town it read first. Only 79 of 175 cities carry a population value.
- **Hà Nội is `fclass = 'national_capital'`**, not `'city'`. A filter of `fclass IN ('city','town')` silently omits the capital.

## Cost

The tile cache grows with use. If disk gets tight, truncate it — tiles re-render on demand:

```bash
curl -u admin:$PW -XPOST -H "Content-Type: text/xml" \
  --data '<truncateLayer><layerName>webatlas:basemap</layerName></truncateLayer>' \
  http://localhost:8080/geoserver/gwc/rest/masstruncate
```

Seeding the cache ahead of time trades disk for latency and is worth doing before a demo; GeoServer has degraded badly under sustained on-demand load on this project before.
