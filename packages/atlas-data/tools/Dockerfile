# atlas-tools: everything the registry's `tools` stages need that a developer's machine must NOT be
# asked to install (spec D2) — the Python geo stack, raster2pgsql and psql, bash and curl.
#
# Based on the database image so raster2pgsql tracks the server's PostGIS (the reasoning in the old
# raster-tools.Dockerfile, which this replaces). Scripts are not copied in: the compose `tools`
# service bind-mounts the repository at /repo, so an edited script needs no rebuild.
FROM postgis/postgis:16-3.4

# The base image is Debian 11 (bullseye), now EOL: its mirrors moved to archive.debian.org, and its
# Python is 3.9 (requirements.txt is pinned for that). The pgdg line is left alone.
RUN sed -i -E 's#https?://(deb|security)\.debian\.org/debian(-security)?#http://archive.debian.org/debian\2#; /bullseye-(updates|security)/d' /etc/apt/sources.list \
 && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgis python3 python3-venv curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/atlas-venv \
 && /opt/atlas-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PATH="/opt/atlas-venv/bin:${PATH}"

# Fail the build, not a stage hours later, if anything is missing.
RUN command -v raster2pgsql && command -v psql && command -v curl \
 && python3 -c "import geopandas, pyogrio, rasterio, psycopg2, sqlalchemy, geoalchemy2, requests"

# The base image's entrypoint starts a PostgreSQL server; this is a tools image, not a database.
ENTRYPOINT []
CMD ["bash"]
