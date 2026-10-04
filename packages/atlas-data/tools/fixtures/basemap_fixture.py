#!/usr/bin/env python3
"""
The committed basemap fixture for CI: cut it from a built atlas, load it into an empty database,
and check that the entities built from it are the real atlas's.

    python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build    # needs a fully built atlas
    python3 packages/atlas-data/tools/fixtures/basemap_fixture.py load     # CI: before reference:build
    python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify   # CI: after reference:build

Standard library only, so it runs on a CI runner, in the atlas-tools image and on a developer's host.
All SQL goes through psql. The connection comes from DATABASE_URL when it is set (split into PG*
variables for the child, so the password never appears in an argv), otherwise from the PG* variables
already in the environment.

Design: docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md
"""
import gzip
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
# packages/atlas-data/tools/fixtures/basemap_fixture.py -> packages/atlas-data/fixtures/basemap
FIXTURE_DIR = pathlib.Path(os.environ.get("BASEMAP_FIXTURE_DIR") or HERE.parents[1] / "fixtures" / "basemap")
DESCRIPTOR = HERE.parents[1] / "src" / "descriptors" / "basemap.ts"
MANIFEST = "MANIFEST.json"
SCHEMA = "schema.sql"

# Table -> the rows the fixture keeps. A superset of what buildReferenceEntities reads (a row whose
# route number or name is not null), so the entities built from the fixture are the real atlas's.
# railways_vn and places_region are small enough to keep whole; locate_place reads places_region.
TABLES = {
    "roads_region": "name IS NOT NULL OR ref IS NOT NULL",
    "water_region": "name IS NOT NULL",
    "landuse_region": "name IS NOT NULL",
    "railways_vn": "TRUE",
    "places_region": "TRUE",
}

# One line per layer: key, entity count, sha256 over the sorted lines "entity_id|member_count".
DIGEST_SQL = """/* fixture:digest */
SELECT layer_key, count(*),
       encode(sha256(convert_to(
         string_agg(entity_id || '|' || member_count, E'\\n' ORDER BY entity_id COLLATE "C"), 'UTF8')), 'hex')
  FROM basemap.reference_entities
 GROUP BY layer_key
 ORDER BY layer_key"""

# The member rows buildReferenceEntities would read, per layer (apps/api/src/db/referenceEntities.ts).
# Used only by `build`, to notice a reference_entities that is older than the tables it came from.
MEMBER_ROWS_SQL = {
    "roads": """SELECT count(*) FROM basemap.roads_region t
                  LEFT JOIN LATERAL (SELECT nullif(btrim(x), '') AS tok
                                       FROM unnest(string_to_array(coalesce(t.ref, ''), ';')) AS x) k ON true
                 WHERE coalesce(k.tok, t.name) IS NOT NULL AND t.geometry IS NOT NULL""",
    "railways": "SELECT count(*) FROM basemap.railways_vn WHERE name IS NOT NULL AND geometry IS NOT NULL",
    "water": "SELECT count(*) FROM basemap.water_region WHERE name IS NOT NULL AND geometry IS NOT NULL",
    "landuse": "SELECT count(*) FROM basemap.landuse_region WHERE name IS NOT NULL AND geometry IS NOT NULL",
    "places": "SELECT count(*) FROM basemap.places_region WHERE name IS NOT NULL AND geometry IS NOT NULL",
}

SAFE_TABLE = re.compile(r"^basemap\.[a-z_]+$")
SAFE_COLUMN = re.compile(r"^[a-z_][a-z0-9_]*$")


class FixtureError(Exception):
    pass


def child_env() -> dict:
    """The environment for psql and pg_dump: DATABASE_URL, when set, becomes PG* variables."""
    env = dict(os.environ)
    url = env.get("DATABASE_URL", "")
    if url:
        u = urllib.parse.urlsplit(url)
        if u.hostname:
            env["PGHOST"] = u.hostname
        if u.port:
            env["PGPORT"] = str(u.port)
        if u.username:
            env["PGUSER"] = urllib.parse.unquote(u.username)
        if u.password:
            env["PGPASSWORD"] = urllib.parse.unquote(u.password)
        if u.path.strip("/"):
            env["PGDATABASE"] = u.path.strip("/")
    return env


def psql_argv(*args: str) -> list:
    # ATLAS_PSQL is split like a shell command; the tests point it at a stub.
    return shlex.split(os.environ.get("ATLAS_PSQL") or "psql") + ["-X", "-q", "-v", "ON_ERROR_STOP=1", *args]


def query(sql: str) -> bytes:
    """One statement; its unaligned, tuples-only output as bytes."""
    r = subprocess.run(psql_argv("-At", "-c", sql), env=child_env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise FixtureError("psql failed: " + r.stderr.decode("utf-8", "replace").strip())
    return r.stdout


def rows(sql: str) -> list:
    return [line.split("|") for line in query(sql).decode("utf-8").splitlines() if line.strip()]


def scalar(sql: str) -> str:
    return query(sql).decode("utf-8").strip()


def read_manifest() -> dict:
    path = FIXTURE_DIR / MANIFEST
    if not path.exists():
        raise FixtureError(f"{path} is missing")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    for f in manifest["files"]:
        if not SAFE_TABLE.match(f["table"]) or not all(SAFE_COLUMN.match(c) for c in f["columns"]):
            raise FixtureError(f"{MANIFEST}: unexpected table or column name in the entry for {f['file']}")
    return manifest


def checked_files(manifest: dict) -> dict:
    """File name -> its bytes, once every file has matched its sha256."""
    blobs = {}
    for f in manifest["files"]:
        path = FIXTURE_DIR / f["file"]
        if not path.exists():
            raise FixtureError(f"{f['file']} is missing from {FIXTURE_DIR}; nothing was loaded")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != f["sha256"]:
            raise FixtureError(f"{f['file']} does not match its sha256 in {MANIFEST}; nothing was loaded")
        blobs[f["file"]] = raw
    return blobs


# --- load ---------------------------------------------------------------------------------------

def cmd_load() -> None:
    manifest = read_manifest()
    blobs = checked_files(manifest)
    schema_path = FIXTURE_DIR / SCHEMA
    if not schema_path.exists():
        raise FixtureError(f"{SCHEMA} is missing from {FIXTURE_DIR}; nothing was loaded")
    schema = schema_path.read_text(encoding="utf-8")

    # Never over a real atlas: a target table may exist (an earlier fixture load), but it must be empty.
    names = ", ".join("'" + f["table"].split(".")[1] + "'" for f in manifest["files"])
    existing = [r[0] for r in rows(
        "/* fixture:existing */ SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        f"WHERE n.nspname = 'basemap' AND c.relkind = 'r' AND c.relname IN ({names}) ORDER BY 1")]
    for name in existing:
        if scalar(f"/* fixture:rows */ SELECT EXISTS (SELECT 1 FROM basemap.{name})") == "t":
            raise FixtureError(
                f"basemap.{name} already holds rows. The fixture is for an empty database (CI); "
                "it never replaces a loaded basemap. Nothing was loaded.")

    parts = [b"/* fixture:load */\n"]
    for f in manifest["files"]:
        parts.append(f"DROP TABLE IF EXISTS {f['table']};\n".encode())
    parts.append(schema.encode("utf-8"))
    parts.append(b"\n")
    for f in manifest["files"]:
        table, want = f["table"], int(f["rows"])
        columns = ", ".join(f'"{c}"' for c in f["columns"])
        data = gzip.decompress(blobs[f["file"]])
        parts.append(f"COPY {table} ({columns}) FROM STDIN;\n".encode())
        parts.append(data if data.endswith(b"\n") or not data else data + b"\n")
        parts.append(b"\\.\n")
        # Inside the transaction: a short or long load rolls everything back.
        parts.append((
            f"DO $$ DECLARE n bigint; BEGIN SELECT count(*) INTO n FROM {table}; "
            f"IF n <> {want} THEN RAISE EXCEPTION '{table}: loaded % rows, the manifest says {want}', n; "
            "END IF; END $$;\n").encode())
        parts.append(f"ANALYZE {table};\n".encode())

    r = subprocess.run(psql_argv("--single-transaction", "-f", "-"), env=child_env(),
                       input=b"".join(parts), stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise FixtureError("psql failed and the transaction was rolled back, so nothing was loaded: "
                           + r.stderr.decode("utf-8", "replace").strip())
    for f in manifest["files"]:
        print(f"loaded {f['table']}: {int(f['rows']):,} rows")
    print(f"fixture cut from {manifest['source']['extract']}")


# --- verify -------------------------------------------------------------------------------------

def built_entities() -> dict:
    return {layer: {"count": int(n), "sha256": digest} for layer, n, digest in rows(DIGEST_SQL)}


def cmd_verify() -> None:
    want = read_manifest()["referenceEntities"]
    got = built_entities()
    problems = []
    for layer in sorted(set(want) | set(got)):
        w = want.get(layer, {"count": 0, "sha256": ""})
        g = got.get(layer, {"count": 0, "sha256": ""})
        if g["count"] != w["count"]:
            problems.append(f"{layer}: built {g['count']} entities, the manifest says {w['count']}")
        elif g["sha256"] != w["sha256"]:
            problems.append(f"{layer}: {g['count']} entities as expected, but their ids or member counts differ")
        else:
            print(f"ok   {layer}: {g['count']:,} entities match the atlas the fixture was cut from")
    if problems:
        raise FixtureError(
            "the entities built from the fixture are not those of the atlas it was cut from:\n  "
            + "\n  ".join(problems)
            + "\n  Rebuild them (npm run reference:build -w @webatlas/api), or regenerate the fixture: "
              "see packages/atlas-data/fixtures/basemap/README.md")


# --- build --------------------------------------------------------------------------------------

def dump_schema() -> str:
    argv = shlex.split(os.environ.get("ATLAS_PG_DUMP") or "pg_dump") + ["--schema-only", "--no-owner", "--no-privileges"]
    for table in TABLES:
        argv += ["-t", f"basemap.{table}"]
    r = subprocess.run(argv, env=child_env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise FixtureError("pg_dump failed: " + r.stderr.decode("utf-8", "replace").strip())
    # Keep only the CREATE TABLE and CREATE INDEX statements. pg_dump also writes session SETs and,
    # in recent versions, \restrict lines carrying a random token, which an older psql rejects and
    # which would change the file on every run.
    lines = [l for l in r.stdout.decode("utf-8").splitlines() if l.strip() and not l.startswith(("--", "\\"))]
    statements = [s.strip() for s in "\n".join(lines).split(";\n")]
    kept = [s.rstrip(";") for s in statements if s.startswith(("CREATE TABLE basemap.", "CREATE INDEX "))]
    created = [s for s in kept if s.startswith("CREATE TABLE")]
    if len(created) != len(TABLES):
        raise FixtureError(f"pg_dump described {len(created)} tables, expected {len(TABLES)}")
    header = (
        "-- The five basemap tables of the CI fixture, as load_basemap.py (through geopandas) creates them.\n"
        "-- Generated by packages/atlas-data/tools/fixtures/basemap_fixture.py build. Do not edit by hand.\n"
        "CREATE SCHEMA IF NOT EXISTS basemap;\n\n")
    return header + ";\n".join(kept) + ";\n"


def pinned_extract() -> str:
    m = re.search(r"const DATE = '(\d{6})'", DESCRIPTOR.read_text(encoding="utf-8"))
    if not m:
        raise FixtureError(f"cannot read the pinned DATE from {DESCRIPTOR}")
    return f"vietnam-{m.group(1)}-free.shp.zip"


def cmd_build() -> None:
    for table in TABLES:
        if scalar(f"SELECT to_regclass('basemap.{table}') IS NOT NULL") != "t":
            raise FixtureError(f"basemap.{table} does not exist: build the atlas first (npm run atlas:up)")
    if scalar("SELECT EXISTS (SELECT 1 FROM basemap.roads_region WHERE name IS NULL AND ref IS NULL)") != "t":
        raise FixtureError(
            "basemap.roads_region holds no unnamed road, so this database was loaded from the fixture, "
            "not built from the extract. Cut the fixture from a full atlas.")
    for layer, sql in MEMBER_ROWS_SQL.items():
        source = int(scalar(sql))
        stored = int(scalar(f"SELECT coalesce(sum(member_count), 0) FROM basemap.reference_entities WHERE layer_key = '{layer}'"))
        if source != stored:
            raise FixtureError(
                f"basemap.reference_entities is stale for {layer}: its entities hold {stored} members, the table "
                f"now yields {source}. Run: npm run atlas:build -- --force reference_entities")

    staged = {SCHEMA: dump_schema().encode("utf-8")}
    files = []
    for table, rule in TABLES.items():
        columns = [r[0] for r in rows(
            "SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema = 'basemap' AND table_name = '{table}' ORDER BY ordinal_position")]
        column_list = ", ".join(f'"{c}"' for c in columns)
        # A total order, so unchanged data gives identical bytes: OSM ids repeat in the area tables.
        data = query(
            f"COPY (SELECT {column_list} FROM basemap.{table} WHERE {rule} "
            'ORDER BY osm_id COLLATE "C", md5(ST_AsEWKB(geometry)) COLLATE "C") TO STDOUT')
        blob = gzip.compress(data, compresslevel=9, mtime=0)
        name = f"{table}.copy.gz"
        count = data.count(b"\n")
        staged[name] = blob
        files.append({
            "table": f"basemap.{table}", "file": name, "rule": rule, "columns": columns,
            "rows": count, "sha256": hashlib.sha256(blob).hexdigest(),
        })
        print(f"{name}: {count:,} rows, {len(blob) / 1048576:.2f} MB")

    manifest = {
        "description": "Every named feature of the six working-region provinces, for the api CI job. "
                       "See README.md beside this file.",
        "source": {
            "extract": pinned_extract(),
            "licence": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors, via Geofabrik",
        },
        "files": files,
        "referenceEntities": built_entities(),
    }
    staged[MANIFEST] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

    # Written only now: a failure above leaves the previous fixture untouched.
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, blob in staged.items():
        (FIXTURE_DIR / name).write_bytes(blob)
    total = sum(len(b) for n, b in staged.items() if n.endswith(".gz"))
    print(f"wrote {len(staged)} files to {FIXTURE_DIR} ({total / 1048576:.1f} MB of table data)")


COMMANDS = {"build": cmd_build, "load": cmd_load, "verify": cmd_verify}


def main(argv: list) -> int:
    if len(argv) != 2 or argv[1] not in COMMANDS:
        print("usage: basemap_fixture.py <build|load|verify>", file=sys.stderr)
        return 2
    try:
        COMMANDS[argv[1]]()
    except FixtureError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
