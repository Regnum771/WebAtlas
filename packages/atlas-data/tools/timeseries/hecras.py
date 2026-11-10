"""HEC-RAS 2D results (.hdf, HDF5) -> flood depth steps on a DEM grid in the area's own CRS."""
import math
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

import h5py
import numpy as np
from affine import Affine
from rasterio import features
from shapely.geometry import Polygon

from .model import Step
from workspace_common import UserFacingError

MIN_DEPTH = 0.05  # depth at or below this many metres is nodata
_AREAS = "Geometry/2D Flow Areas"
_TS = "Results/Unsteady/Output/Output Blocks/Base Output/Unsteady Time Series"
_NO_RESULTS = "Tệp .hdf không có kết quả mô phỏng (thiếu nhóm Results)."


def _text(v) -> str:
    return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)


def _parse_stamp(s: str) -> datetime:
    s = s.strip()
    # HEC-RAS writes midnight as 24:00:00 in some versions
    if s.endswith(" 24:00:00"):
        return datetime.strptime(s[:-9], "%d%b%Y").replace(tzinfo=timezone.utc) + timedelta(days=1)
    return datetime.strptime(s, "%d%b%Y %H:%M:%S").replace(tzinfo=timezone.utc)


class RasFile:
    """Open HEC-RAS result file. Use as a context manager; arrays are read lazily, one row at a time."""

    def __init__(self, path: str):
        self.path = path
        self._f: Optional[h5py.File] = None
        self._times: Optional[list] = None

    def __enter__(self):
        try:
            self._f = h5py.File(self.path, "r")
        except FileNotFoundError:
            raise UserFacingError("Không tìm thấy tệp .hdf.")
        except OSError:
            raise UserFacingError("Không đọc được tệp .hdf (không phải tệp HDF5 hợp lệ).")
        if _AREAS + "/Attributes" not in self._f:
            self._f.close()
            raise UserFacingError("Tệp .hdf không phải kết quả HEC-RAS 2D (thiếu vùng dòng chảy 2D).")
        return self

    def __exit__(self, *exc):
        if self._f is not None:
            self._f.close()
            self._f = None

    @property
    def areas(self) -> list:
        return [_text(n).strip() for n in self._f[_AREAS + "/Attributes"]["Name"]]

    @property
    def crs_wkt(self) -> str:
        return _text(self._f.attrs["Projection"])

    @property
    def times(self) -> list:
        if self._times is None:
            key = _TS + "/Time Date Stamp"
            if key not in self._f:
                raise UserFacingError(_NO_RESULTS)
            self._times = [_parse_stamp(_text(s)) for s in self._f[key][:]]
        return self._times

    def n_cells(self, area: str) -> int:
        """Real cells of the area (the arrays also hold ghost cells after them)."""
        return int(self._f[_AREAS + "/Cell Info"][self.areas.index(area)][1])

    def _cells(self, area: str):
        g = self._f[f"{_AREAS}/{area}"]
        n = self.n_cells(area)
        return g["Cells FacePoint Indexes"][:n], g["FacePoints Coordinate"][:]

    def extent(self, area: str) -> tuple:
        """(xmin, ymin, xmax, ymax) of the real cells' polygons."""
        cells, fp = self._cells(area)
        used = np.unique(cells[cells >= 0])
        xy = fp[used]
        return (float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max()))

    def cell_min_elevation(self, area: str) -> np.ndarray:
        return self._f[f"{_AREAS}/{area}/Cells Minimum Elevation"][: self.n_cells(area)]

    def water_surface(self, area: str, i: int) -> np.ndarray:
        """Water surface elevation of the real cells at step i (one row; never the full array)."""
        key = f"{_TS}/2D Flow Areas/{area}/Water Surface"
        if key not in self._f:
            raise UserFacingError(_NO_RESULTS)
        return self._f[key][i, : self.n_cells(area)]


def pick_area(ras: RasFile, area: Optional[str]) -> str:
    areas = ras.areas
    if area:
        if area not in areas:
            raise UserFacingError(f"Không có vùng 2D tên '{area}' trong tệp .hdf. Các vùng có: {', '.join(areas)}.")
        return area
    if len(areas) == 1:
        return areas[0]
    raise UserFacingError(f"Tệp .hdf có nhiều vùng 2D, hãy chọn một: {', '.join(areas)}.")


def area_grid(ras: RasFile, area: str, res: float = 30.0) -> tuple:
    """(transform, shape) of a `res`-metre grid in the area's CRS covering its extent."""
    xmin, ymin, xmax, ymax = ras.extent(area)
    shape = (math.ceil((ymax - ymin) / res), math.ceil((xmax - xmin) / res))
    return Affine(res, 0, xmin, 0, -res, ymin + shape[0] * res), shape


def cell_index_grid(ras: RasFile, area: str, transform: Affine, shape: tuple) -> np.ndarray:
    """int32 grid with the index of the real cell covering each pixel, -1 outside any cell."""
    cells, fp = ras._cells(area)
    shapes = ((Polygon(fp[idx[idx >= 0]]), i) for i, idx in enumerate(cells))
    return features.rasterize(shapes, out_shape=shape, transform=transform, fill=-1, dtype="int32")


def _depth(wse: np.ndarray, grid: np.ndarray, dem: np.ndarray) -> np.ndarray:
    depth = np.where(grid >= 0, wse[grid.clip(0)] - dem, np.nan).astype("float32")
    depth[~(depth > MIN_DEPTH)] = np.nan  # dry, negative and NaN all become nodata
    return depth


def depth_steps(ras: RasFile, area: str, dem: np.ndarray, transform: Affine, every: int = 4) -> Iterator[Step]:
    """Depth = water surface - DEM for steps 0, every, 2*every, ... (every=4 is hourly for 15-min output)."""
    times = ras.times
    grid = cell_index_grid(ras, area, transform, dem.shape)
    for i in range(0, len(times), max(1, every)):
        yield Step(times[i], _depth(ras.water_surface(area, i), grid, dem), transform, ras.crs_wkt)


def peak_depth(ras: RasFile, area: str, dem: np.ndarray, transform: Affine) -> Step:
    """Per-pixel maximum depth over every output step; its time is the last step's."""
    times = ras.times
    grid = cell_index_grid(ras, area, transform, dem.shape)
    peak = np.full(dem.shape, np.nan, dtype="float32")
    for i in range(len(times)):
        peak = np.fmax(peak, _depth(ras.water_surface(area, i), grid, dem))
    return Step(times[-1], peak, transform, ras.crs_wkt)
