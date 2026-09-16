#!/usr/bin/env python3
"""Download FABDEM tiles and clip them to the six working-region provinces.

Output is a DIRECTORY of per-tile GeoTIFFs, not one mosaic: a mosaic over the region's
bounding box would be mostly empty sea (see "islands" below) and would need ~1 GB of RAM to
assemble, raster2pgsql takes a whole glob of files and tiles them into one table anyway, and
per-tile keeps the work resumable.

SOURCE: FABDEM V1-2 (Hawker et al. 2022), University of Bristol.
    https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn

FABDEM is Copernicus GLO-30 with forest and building height biases removed by machine
learning, i.e. BARE EARTH rather than a surface model. That is why it is used here instead
of raw Copernicus: elevations over Tay Nguyen forest read the ground, not the canopy, and
contours derived from it are cartographic rather than merely de-noised.

    LICENCE: CC BY-NC-SA 4.0 - NON-COMMERCIAL, share-alike. This project is a public-sector
    deliverable, which is what makes the dataset usable here. If that ever changes, this
    source cannot stay: Fathom sells a commercial equivalent (FABDEM+/FathomDEM), and raw
    Copernicus GLO-30 (no licence restriction, but a surface model) is the fallback.

    ATTRIBUTION, required wherever these elevations surface: see FABDEM_ATTRIBUTION in
    packages/shared/src/legend.ts (also quoted in docs/runbooks/elevation-dem.md).

    CITATION: Hawker, L., Uhe, P., Paulo, L., Sosa, J., Savage, J., Sampson, C., & Neal, J.
    (2022). A 30 m global map of elevation with forests and buildings removed.
    Environmental Research Letters, 17(2), 024016.

Horizontal CRS WGS84 (EPSG:4326), vertical datum EGM2008 (EPSG:3855) - the same vertical
datum as Copernicus GLO-30, so values are directly comparable with anything measured before
the switch, and no datum shift is needed.

DISTRIBUTION - why this does not download from data.bris. The authoritative Bristol
distribution ships 10x10 degree ZIPs with no per-tile URL: 1.7 GB to obtain the ~18 tiles
this region needs, and measured at 23 KB/s from here, which is a 20-hour download. The
mirror below serves the same tiles individually at ~7.6 MB/s.

    MIRROR: Fondazione LINKS - AI, Data & Space, via the public Hugging Face bucket
    links-ads/fabdem. The tiles were rewritten from the Bristol distribution into valid
    Cloud-Optimized GeoTIFFs with overview pyramids; the mirror states PIXEL VALUES ARE
    UNCHANGED, only the container differs. No authentication, and the bucket has no per-IP
    rate ceiling.

    This is a third-party mirror of a public dataset, which is the dependency class that
    already bit this project once (CARTO). data.bris stays the canonical fallback: slow,
    but authoritative. If the numbers here are ever disputed, re-fetch one tile from
    Bristol and compare.

Requires the Python geo stack plus rasterio (rasterio is NOT needed by the other scripts in
this directory, so it is an extra install):

    pip install rasterio shapely

Usage:
    python prep_dem.py --mainland      # what you almost certainly want
    python prep_dem.py                 # includes the archipelago cells
    python prep_dem.py --dry-run       # list tiles and archives, download nothing
    python prep_dem.py --out /tmp/dem  # somewhere else

System GDAL / ogr2ogr is not required: rasterio bundles its own, same as prep_hydrosheds.py.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys
import urllib.error
import urllib.request

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

# rasterio is imported lazily inside clip(): it is the one heavy, non-obvious dependency
# here (the other scripts in this directory do not need it), and --dry-run exists precisely
# so you can check the tile list before installing anything or downloading a byte.

# Repo root is three levels up: apps/api/scripts/prep_dem.py
ROOT = pathlib.Path(__file__).resolve().parents[3]

# Keep in sync with REGION_PROVINCE_CODES in packages/shared/src/region.ts. A .py script
# cannot import the TS constant, the same duplication fetch-boundaries.mjs lives with.
REGION_PROVINCE_CODES = {"48", "51", "52", "56", "66", "68"}

PROVINCES = ROOT / "apps/web/public/provinces-34.geojson"
DEFAULT_OUT = ROOT / "apps/api/src/db/seeds/data/dem"

VERSION = "V1-2"
# Per-tile COGs. Path shape: .../resolve/tiles/<10deg block>/<1deg tile>.tif
MIRROR_URL = "https://huggingface.co/buckets/links-ads/fabdem/resolve/tiles"
# The authoritative distribution, kept here because it is what the licence and the citation
# refer to, and the fallback if the mirror ever goes away.
UPSTREAM_URL = "https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn"

# The clip mask is padded by roughly one DEM pixel so the province edge is not shaved off by
# rounding. 30 m is ~0.00028 degrees; 0.001 deg (~110 m) is a few pixels of slack, which
# costs nothing and guarantees full coverage of any feature sitting on a boundary.
MASK_PAD_DEG = 0.001


def _ns_ew(lat: int, lon: int) -> tuple[str, str]:
    return ("N" if lat >= 0 else "S", "E" if lon >= 0 else "W")


def tile_name(lat: int, lon: int) -> str:
    """FABDEM tile for the 1x1 degree cell whose SOUTH-WEST corner is (lat, lon)."""
    ns, ew = _ns_ew(lat, lon)
    return f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}_FABDEM_{VERSION}.tif"


def block_dir(lat: int, lon: int) -> str:
    """The 10x10 degree grouping the tile sits under, labelled SW corner to NE corner.

    No extension: upstream this names a .zip archive, but the mirror uses the same string as
    a directory. Appending .zip here (which an earlier version did, carried over from the
    Bristol naming) makes every tile URL 404.
    """
    blat, blon = math.floor(lat / 10) * 10, math.floor(lon / 10) * 10
    ns0, ew0 = _ns_ew(blat, blon)
    ns1, ew1 = _ns_ew(blat + 10, blon + 10)
    return (
        f"{ns0}{abs(blat):02d}{ew0}{abs(blon):03d}-"
        f"{ns1}{abs(blat + 10):02d}{ew1}{abs(blon + 10):03d}_FABDEM_{VERSION}"
    )


def region_geometry():
    """Union of the six working-region province polygons, in EPSG:4326.

    These polygons are the simplified ones the browser renders (Douglas-Peucker at
    0.0001 deg / ~11 m, see fetch-boundaries.mjs). That is irrelevant here: they are only
    deciding which 30 m pixels to keep, and MASK_PAD_DEG covers the difference several times
    over. Do NOT reuse this reasoning for anything that measures against a boundary.
    """
    data = json.loads(PROVINCES.read_text(encoding="utf-8"))
    polys = [
        shape(f["geometry"])
        for f in data["features"]
        if str(f["properties"].get("code")) in REGION_PROVINCE_CODES
    ]
    if len(polys) != len(REGION_PROVINCE_CODES):
        sys.exit(
            f"Expected {len(REGION_PROVINCE_CODES)} region provinces in {PROVINCES.name}, "
            f"found {len(polys)} - has the boundary file or the region changed?"
        )
    return unary_union(polys).buffer(MASK_PAD_DEG)


def mainland_of(region):
    """The contiguous mainland landmass: the largest polygon of the region union.

    Geometric rather than a longitude cutoff, which is what an earlier version used and got
    wrong. Hoang Sa and Truong Sa belong to Da Nang and Khanh Hoa, and Truong Sa reaches down
    to ~7 deg N while staying WEST of 110 deg E - so a lon-only rule kept one lone reef cell,
    and because FABDEM ships 10x10 degree archives that single cell pulled in a second 1.7 GB
    download for a few pixels of coral. Taking the largest polygon drops every outlying island
    with no magic numbers, and says what it means.

    This is a download-cost switch, not a statement about the region.
    """
    geoms = getattr(region, "geoms", None)
    return max(geoms, key=lambda g: g.area) if geoms else region


def tiles_for(mask) -> list[tuple[int, int]]:
    """Every 1x1 degree cell that actually intersects `mask`.

    Intersecting the GEOMETRY, not its bounding box: the full region's bbox runs out to lon
    ~117.8 because of the archipelagos, and a bbox-driven list would be a hundred-odd cells of
    open sea.
    """
    minx, miny, maxx, maxy = mask.bounds
    out = []
    for lat in range(math.floor(miny), math.ceil(maxy)):
        for lon in range(math.floor(minx), math.ceil(maxx)):
            if box(lon, lat, lon + 1, lat + 1).intersects(mask):
                out.append((lat, lon))
    return out


def download_tile(lat: int, lon: int, dest: pathlib.Path) -> bool:
    """Fetch one 1-degree tile. False for a tile the mirror does not have.

    A missing tile is normal, not an error: nothing is published for cells that are entirely
    ocean, and the region's coastal cells put a few of those in the candidate list.

    Completeness is checked against Content-Length rather than mere existence, so a tile left
    half-written by an interrupted run is re-fetched instead of failing later inside GDAL.
    """
    url = f"{MIRROR_URL}/{block_dir(lat, lon)}/{tile_name(lat, lon)}"
    try:
        with urllib.request.urlopen(url, timeout=120) as resp:
            expected = int(resp.headers.get("Content-Length") or 0)
            if dest.exists() and expected and dest.stat().st_size == expected:
                print(f"  cached  {dest.name}")
                return True
            tmp = dest.with_suffix(".part")
            with tmp.open("wb") as fh:
                while chunk := resp.read(1 << 20):
                    fh.write(chunk)
            tmp.replace(dest)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"  no tile {tile_name(lat, lon)} (all sea)", flush=True)
            return False
        raise
    print(f"  fetched {dest.name} ({dest.stat().st_size / 1e6:.0f} MB)", flush=True)
    return True


def clip(src_path: pathlib.Path, region, dest: pathlib.Path) -> bool:
    """Clip one tile to the region. False if nothing of it survives.

    Reads a local copy rather than the remote COG through /vsicurl/, which would also work
    and would skip the download entirely: keeping the raw tile means re-clipping (after a
    boundary change, say) costs nothing and works offline.
    """
    import rasterio
    from rasterio.mask import mask as rio_mask

    with rasterio.open(src_path) as src:
        if not box(*src.bounds).intersects(region):
            return False
        # nodata must be set explicitly: outside the mask the tool layer relies on ST_Value
        # returning NULL rather than a plausible-looking 0 m at sea level.
        nodata = src.nodata if src.nodata is not None else -9999.0
        try:
            data, transform = rio_mask(src, [mapping(region)], crop=True, nodata=nodata, filled=True)
        except ValueError:
            return False  # disjoint after the precise mask
        profile = src.profile | {
            "height": data.shape[1],
            "width": data.shape[2],
            "transform": transform,
            "nodata": nodata,
            "compress": "deflate",
            "predictor": 3,  # floating-point predictor; ~2x better than none on a DEM
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
        }
        with rasterio.open(dest, "w", **profile) as dst:
            dst.write(data)
    return True


def drop_stale(clipped: pathlib.Path, keep: set[str]) -> None:
    """Delete clips that are not part of this run.

    The footgun this exists to prevent: load-dem.sh globs the whole directory, so clips left
    over from a different source (this pipeline used raw Copernicus GLO-30 before FABDEM)
    would be loaded into the same table alongside the new ones, silently mixing a surface
    model and a bare-earth model in one raster.
    """
    for old in sorted(clipped.glob("*.tif")):
        if old.name not in keep:
            print(f"  removing stale clip {old.name}")
            old.unlink()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--mainland",
        action="store_true",
        help="keep only the contiguous mainland landmass, dropping the Hoang Sa and Truong Sa "
        "cells: far fewer tiles and archives, and nothing the elevation tools are asked about "
        "today lives out there",
    )
    args = ap.parse_args()

    region = region_geometry()
    mask = mainland_of(region) if args.mainland else region
    tiles = tiles_for(mask)
    print(f"Region bounds: {tuple(round(v, 2) for v in region.bounds)}")
    if args.mainland:
        print(f"Mainland bounds: {tuple(round(v, 2) for v in mask.bounds)}")
    print(f"{len(tiles)} candidate 1-degree tiles" + (" (mainland landmass only)" if args.mainland else ""))
    if args.dry_run:
        for lat, lon in tiles:
            print(f"  {tile_name(lat, lon)}")
        return

    raw = args.out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    clipped = args.out / "clipped"
    clipped.mkdir(parents=True, exist_ok=True)

    kept: set[str] = set()
    for lat, lon in tiles:
        member = tile_name(lat, lon)
        src = raw / member
        if not download_tile(lat, lon, src):
            continue
        out_name = member.replace(".tif", "_clip.tif")
        if clip(src, mask, clipped / out_name):
            kept.add(out_name)
            print(f"  clipped {member}", flush=True)

    if not kept:
        probe = f"{MIRROR_URL}/{block_dir(*tiles[0])}/{tile_name(*tiles[0])}"
        sys.exit(
            "Every tile was missing. That is not an ocean - it means the tile URLs are wrong "
            "(mirror moved or renamed?). Check one by hand:\n"
            f"  {probe}\n"
            f"Upstream fallback: {UPSTREAM_URL}\n"
            "Nothing was deleted; existing clips are untouched."
        )

    drop_stale(clipped, kept)
    total = sum(p.stat().st_size for p in clipped.glob("*.tif"))
    print(f"\n{len(kept)} clipped tiles in {clipped} ({total / 1e6:.0f} MB)")
    print("Raw tiles kept in ./raw for re-clipping; delete them once satisfied.")
    print("Next: apps/api/scripts/load-dem.sh")


if __name__ == "__main__":
    main()
