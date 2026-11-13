"""
Recolours existing flood frames to the current colours of depth.py (BANDS), without rebuilding the
scenarios. Frames carry depth in 0.25 m steps, so each old colour maps to exactly one step.

--from names the colours the frames were drawn with: `blue-bands` (the five blues used until
2026-11-13, the default) or `smooth` (the ramp before the bands).

    docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
        python3 packages/atlas-data/tools/flood_scenario/recolor_frames.py [--from blue-bands|smooth] [frames-dir]
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


def blue_band_rgba(d):
    """The five banded blues the frames were drawn with until 2026-11-13."""
    k = np.where(d > 0, np.clip(np.round(d / depth.STEP_M), 1, depth.MAX_STEP), 0).astype(np.intp)
    return depth.lut(depth.BLUE_BANDS)[k]


SOURCES = {"blue-bands": blue_band_rgba, "smooth": old_rgba}


def recolor(img, source="blue-bands"):
    """Each step's colour under `source` becomes its colour under depth.BANDS. A pixel already in the
    current colours stays, so a second run changes nothing; any other pixel goes transparent."""
    steps = np.array([[k * depth.STEP_M for k in range(1, depth.MAX_STEP + 1)]], "float32")
    olds = SOURCES[source](steps)[0]
    news = depth.depth_rgba(steps)[0]
    out = np.zeros_like(img)
    for new in news:
        out[(img == new).all(axis=-1)] = new
    for old, new in zip(olds, news):
        hit = (img == old).all(axis=-1)
        out[hit] = new
    return out


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from", dest="source", choices=sorted(SOURCES), default="blue-bands")
    ap.add_argument("frames", nargs="?", type=pathlib.Path, default=FRAMES)
    args = ap.parse_args(argv)
    files = sorted(args.frames.glob("*/*.png"))
    for path in files:
        with rasterio.open(path) as src:
            img = np.moveaxis(src.read(), 0, 2)
        out = recolor(img, args.source)
        with warnings.catch_warnings(), rasterio.Env(GDAL_PAM_ENABLED="NO"):
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            with rasterio.open(path, "w", driver="PNG", width=out.shape[1], height=out.shape[0], count=4,
                               dtype="uint8", ZLEVEL=9) as dst:
                dst.write(np.moveaxis(out, 2, 0))
    print(f"recoloured {len(files)} frames from {args.source}")


if __name__ == "__main__":
    main()
