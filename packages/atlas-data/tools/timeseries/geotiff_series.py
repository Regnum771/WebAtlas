"""Reader for a series of single-band GeoTIFFs, one per time."""
import numpy as np
import rasterio

from .model import Step


def read_series(files):
    """Yield a Step per (path, time) pair, in the order given. Nodata becomes NaN."""
    for path, t in files:
        with rasterio.open(path, driver="GTiff") as src:
            arr = src.read(1).astype("float32")
            if src.nodata is not None:
                arr[arr == np.float32(src.nodata)] = np.nan
            if src.crs is None:
                raise ValueError(f"{path} has no CRS")
            yield Step(time=t, array=arr, transform=src.transform, crs=src.crs.to_string())
