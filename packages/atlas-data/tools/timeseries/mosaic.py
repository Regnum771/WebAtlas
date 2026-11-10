"""GeoServer ImageMosaic configuration for a folder of time-step COGs, indexed in PostGIS."""
import os
from dataclasses import dataclass


@dataclass
class IndexDb:
    host: str
    port: int
    database: str
    schema: str
    user: str
    password: str


def write_config(out_dir, name, index):
    """Write indexer.properties, timeregex.properties and datastore.properties into out_dir."""
    os.makedirs(out_dir, exist_ok=True)
    files = {
        "timeregex.properties": "regex=[0-9]{8}T[0-9]{6}Z,format=yyyyMMdd'T'HHmmss'Z'",
        "indexer.properties": "\n".join([
            "TimeAttribute=time",
            "Schema=*the_geom:Polygon,location:String,time:java.util.Date",
            "PropertyCollectors=TimestampFileNameExtractorSPI[timeregex](time)",
            "AbsolutePath=false",
            # Only the steps are granules: any other .tif in the folder stays out of the mosaic.
            f"Wildcard={name}_*.tif",
            f"Name={name}",
            "",
        ]),
        "datastore.properties": "\n".join([
            "SPI=org.geotools.data.postgis.PostgisNGDataStoreFactory",
            f"host={index.host}",
            f"port={index.port}",
            f"database={index.database}",
            f"schema={index.schema}",
            f"user={index.user}",
            f"passwd={index.password}",
            "Loose\\ bbox=true",
            "Estimated\\ extends=false",
            "validate\\ connections=true",
            "Connection\\ timeout=10",
            "preparedStatements=true",
            "",
        ]),
    }
    for fname, text in files.items():
        with open(os.path.join(out_dir, fname), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
