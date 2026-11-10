-- Databases and roles the platform stack needs in the shared PostGIS (lean stack: one database
-- server). Idempotent: safe to run again, and running it again resets the four passwords.
--
--   psql -v geonode_pw=... -v geonode_data_pw=... -v orchestrator_pw=... -v mosaic_pw=... \
--     -f platform-databases.sql
--
-- Run as the cluster's superuser (POSTGRES_USER), connected to the webatlas database.

\set ON_ERROR_STOP on

-- GeoNode's catalogue (geonode) and its GeoServer/GeoFence data (geonode_data).
SELECT format('CREATE ROLE geonode LOGIN PASSWORD %L', :'geonode_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geonode') \gexec
SELECT format('ALTER ROLE geonode LOGIN PASSWORD %L', :'geonode_pw') \gexec
SELECT format('CREATE ROLE geonode_data LOGIN PASSWORD %L', :'geonode_data_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geonode_data') \gexec
SELECT format('ALTER ROLE geonode_data LOGIN PASSWORD %L', :'geonode_data_pw') \gexec

SELECT 'CREATE DATABASE geonode OWNER geonode'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'geonode') \gexec
SELECT 'CREATE DATABASE geonode_data OWNER geonode_data'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'geonode_data') \gexec

\connect geonode
CREATE EXTENSION IF NOT EXISTS postgis;
\connect geonode_data
CREATE EXTENSION IF NOT EXISTS postgis;
GRANT ALL ON SCHEMA public TO geonode_data;

-- The ImageMosaic granule index (packages/atlas-data/tools/timeseries): its own database, owned
-- by the cluster superuser running this script, and a role that owns no database and cannot
-- create one. GeoTools' ImageMosaic runs DROP DATABASE on its index when a store is deleted
-- with `purge`; only an owner may drop a database, so here that always fails.
\connect webatlas
SELECT format('CREATE ROLE webatlas_mosaic LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER PASSWORD %L', :'mosaic_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webatlas_mosaic') \gexec
SELECT format('ALTER ROLE webatlas_mosaic LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER PASSWORD %L', :'mosaic_pw') \gexec
SELECT 'CREATE DATABASE webatlas_mosaic_index'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'webatlas_mosaic_index') \gexec
SELECT format('ALTER DATABASE webatlas_mosaic_index OWNER TO %I', current_user) \gexec
REVOKE ALL ON DATABASE webatlas_mosaic_index FROM PUBLIC;
GRANT CONNECT ON DATABASE webatlas_mosaic_index TO webatlas_mosaic;
\connect webatlas_mosaic_index
CREATE EXTENSION IF NOT EXISTS postgis;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO webatlas_mosaic;

-- Dagster reads the dataset registry and nothing else.
\connect webatlas
SELECT format('CREATE ROLE webatlas_orchestrator LOGIN PASSWORD %L', :'orchestrator_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webatlas_orchestrator') \gexec
SELECT format('ALTER ROLE webatlas_orchestrator LOGIN PASSWORD %L', :'orchestrator_pw') \gexec
GRANT USAGE ON SCHEMA app TO webatlas_orchestrator;
GRANT SELECT ON app.dataset_lineage, app.dataset_stage_state TO webatlas_orchestrator;

-- ... and keeps the catalogue (migration 1000000000036_catalogue) in step with GeoNode: it reads and
-- writes catalogue.resources and gives a new resource its managing unit with
-- catalogue.unit_for_bbox (SECURITY DEFINER, so no grant on the admin schema is needed).
GRANT USAGE ON SCHEMA catalogue TO webatlas_orchestrator;
GRANT SELECT, INSERT, UPDATE ON catalogue.resources TO webatlas_orchestrator;
GRANT EXECUTE ON FUNCTION catalogue.unit_for_bbox(float8, float8, float8, float8) TO webatlas_orchestrator;
