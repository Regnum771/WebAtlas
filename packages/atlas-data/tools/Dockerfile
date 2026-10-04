# atlas-tools: everything the registry's `tools` stages need that a developer's machine must NOT be
# asked to install (spec D2) — the Python geo stack, raster2pgsql and psql, bash and curl.
#
# Based on Debian bookworm (supported, Python 3.11) plus the PostgreSQL project's apt repository,
# not on the database image (that one is Debian 11, end-of-life). raster2pgsql therefore comes
# from PGDG's current PostGIS (3.6.x at build time) while the server runs PostGIS 3.4.x. This mismatch is
# accepted deliberately, as in the old raster-tools.Dockerfile: raster2pgsql emits plain INSERTs
# of raster WKB, which is unchanged between 3.4 and later releases, and the DEM load is verified against
# known summits. It does NOT track the server's version.
#
# Scripts are not copied in: the compose `tools` service bind-mounts the repository at /repo, so
# an edited script needs no rebuild.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 postgis python3 python3-venv bash \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/atlas-venv \
 && /opt/atlas-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PATH="/opt/atlas-venv/bin:${PATH}"

# Fail the build, not a stage hours later, if anything is missing.
RUN command -v raster2pgsql && command -v psql && command -v curl \
 && python3 -c "import geopandas, pyogrio, rasterio, psycopg2, sqlalchemy, geoalchemy2, requests"

# A tools image, not a database: nothing starts a server.
ENTRYPOINT []
CMD ["bash"]
