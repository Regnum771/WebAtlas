"""
Recolours existing flood frames from the old smooth ramp to the banded colours of depth.py, without
rebuilding the scenarios. Frames carry depth in 0.25 m steps, so each old colour maps to one step.

    docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools         python3 packages/atlas-data/tools/flood_scenario/recolor_frames.py
"""
import pathlib
import sys
import warnings

import numpy as np
import rasterio
from rasterio.errors import NotGeoreferencedWarning

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import depth  # noqa: E402

FRAMES = HERE.parents[3] / "packages/atlas-data/data/cache/flood/frames"
OLD_RAMP = [(0.0, (0xC6, 0xDB, 0xEF)), (1.5, (0x42, 0x92, 0xC6)), (4.0, (0x08, 0x30, 0x6B))]
OLD_ALPHA = 190


def old_rgba(d):
    """The smooth ramp the frames were drawn with before the bands."""
    c = np.clip(d, 0.0, 4.0)
    stops = np.array([s for s, _ in OLD_RAMP])
    out = np.zeros(d.shape + (4,), dtype=np.uint8)
    for band in range(3):
        out[..., band] = np.round(np.interp(c, stops, [rgb[band] for _, rgb in OLD_RAMP])).astype(np.uint8)
    out[..., 3] = np.where(d > 0, OLD_ALPHA, 0).astype(np.uint8)
    return out


def recolor(img):
    steps = np.array([[k * depth.STEP_M for k in range(1, depth.MAX_STEP + 1)]], "float32")
    olds = old_rgba(steps)[0]
    news = depth.depth_rgba(steps)[0]
    out = np.zeros_like(img)
    for old, new in zip(olds, news):
        hit = (img == old).all(axis=-1)
        out[hit] = new
    return out


def main():
    files = sorted(FRAMES.glob("*/*.png"))
    for path in files:
        with rasterio.open(path) as src:
            img = np.moveaxis(src.read(), 0, 2)
        out = recolor(img)
        with warnings.catch_warnings(), rasterio.Env(GDAL_PAM_ENABLED="NO"):
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            with rasterio.open(path, "w", driver="PNG", width=out.shape[1], height=out.shape[0], count=4,
                               dtype="uint8", ZLEVEL=9) as dst:
                dst.write(np.moveaxis(out, 2, 0))
    print(f"recoloured {len(files)} frames")


if __name__ == "__main__":
    main()
