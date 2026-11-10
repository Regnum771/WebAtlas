"""Plain data types shared by the readers and the writers."""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import numpy as np
from affine import Affine


@dataclass
class Step:
    """One time step: a float32 grid (nodata is NaN) with its georeferencing. `time` is UTC."""
    time: datetime
    array: np.ndarray
    transform: Affine
    crs: str


@dataclass
class SeriesMeta:
    name: str
    title: str
    variable: Literal["depth", "rain", "value"]
    unit: str
    times: list
    bounds4326: tuple
    source_label: str
