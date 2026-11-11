"""Time-series library: turns rainfall grids and HEC-RAS results into a GeoServer ImageMosaic folder."""
import os
import sys

# workspace_common lives beside this package in tools/workspace; modules here import it by name.
_WORKSPACE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "workspace")
if _WORKSPACE not in sys.path:
    sys.path.insert(0, _WORKSPACE)

# Imported here so GDAL is configured before any submodule imports rasterio.
import workspace_common  # noqa: E402,F401
