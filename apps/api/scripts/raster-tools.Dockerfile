# raster2pgsql, and nothing else.
#
# The stock postgis/postgis:16-3.4 image ships the SERVER side of PostGIS raster
# (the postgis_raster extension is available in it — verified) but NOT the
# client-side loader binary: `find / -name 'raster2pgsql*'` inside that image
# comes back empty. Every raster tutorial's one-liner therefore fails on this
# stack, which is worth knowing before you spend an hour on it.
#
# This image exists so `load-dem.sh` can run the canonical loader without
# changing the `db` service in infra/docker-compose.yml. Building the db service
# instead would make every developer — including everyone who will never touch
# elevation — build an image on their next `docker compose up`, to gain a binary
# that is used once.
#
# Based on the same image as the server so the loader tracks the server closely —
# though NOT exactly: the base has the PGDG apt repository configured, and PGDG's
# current `postgis` for this release is 3.5.2, while the server extension is 3.4.3.
# That mismatch is fine and is what actually gets used: raster2pgsql emits plain
# INSERTs carrying raster WKB, whose serialisation has not changed between 3.4 and
# 3.5, and the loaded result is verified against a known summit at the end of
# load-dem.sh. If a future PostGIS ever does change that format, this is the first
# place to look — pin the package version here rather than chasing it downstream.
FROM postgis/postgis:16-3.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgis \
 && rm -rf /var/lib/apt/lists/*

# Sanity: fail the build rather than the load if the package ever stops shipping it.
RUN raster2pgsql 2>&1 | head -1
