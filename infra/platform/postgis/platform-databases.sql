-- Databases and roles the platform stack needs in the shared PostGIS (lean stack: one database
-- server). Idempotent: safe to run again, and running it again resets the three passwords.
--
--   psql -v geonode_pw=... -v geonode_data_pw=... -v orchestrator_pw=... -f platform-databases.sql
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

-- Dagster reads the dataset registry and nothing else.
\connect webatlas
SELECT format('CREATE ROLE webatlas_orchestrator LOGIN PASSWORD %L', :'orchestrator_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webatlas_orchestrator') \gexec
SELECT format('ALTER ROLE webatlas_orchestrator LOGIN PASSWORD %L', :'orchestrator_pw') \gexec
GRANT USAGE ON SCHEMA app TO webatlas_orchestrator;
GRANT SELECT ON app.dataset_lineage, app.dataset_stage_state TO webatlas_orchestrator;
