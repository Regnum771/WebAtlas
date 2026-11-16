"""Template context for the WebATLAS look of GeoNode (K7): where the WebATLAS header's links point.

Added to TEMPLATES[0]["OPTIONS"]["context_processors"] by webatlas_geonode_settings.py.
"""
import os


def webatlas(request):
    return {
        # The WebATLAS web app (its map, data and hub pages) and the Dagster UI, as the browser reaches them.
        "WEBATLAS_WEB_URL": os.environ.get("WEBATLAS_WEB_URL", "http://localhost:5173").rstrip("/"),
        "WEBATLAS_DAGSTER_URL": os.environ.get("WEBATLAS_DAGSTER_URL", "http://localhost:3070").rstrip("/"),
    }
