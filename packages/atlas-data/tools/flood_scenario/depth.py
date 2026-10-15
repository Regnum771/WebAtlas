"""
Flood depth on a grid: a planar ("bathtub") approximation, not a hydraulic model.

A water surface is interpolated from station levels by distance from the sea, ground is subtracted, and only water that
connects to a river channel is kept, so closed hollows far from the river stay dry.
"""
import numpy as np
from scipy import ndimage

# Depth bands (upper bound in metres, RGB): five clearly different blues, so depth reads at a glance.
# Within a band every 0.25 m step adds its index in the band to red: invisible to the eye, but it
# lets the web app read the exact step back from a frame pixel (apps/web .../depthColour.ts mirrors
# this table; keep them in step).
BANDS = [(0.5, (0xBF, 0xE3, 0xF5)), (1.0, (0x74, 0xB9, 0xE6)), (2.0, (0x3A, 0x86, 0xC8)),
         (3.0, (0x1C, 0x56, 0xA0)), (float("inf"), (0x0B, 0x2A, 0x6B))]
STEP_M = 0.25
MAX_STEP = 16  # 4 m; deeper water takes the 4 m colour
ALPHA = 200
# First 0.25 m step of each band: depths 0.25, 0.5, 1, 2, 3 m.
FIRST_STEP = [1, 2, 4, 8, 12]


def _band_of_step(k):
    return next(i for i, (upper, _) in enumerate(BANDS) if k * STEP_M < upper)


def _step_colour(k):
    b = _band_of_step(k)
    r, g, bl = BANDS[b][1]
    return (r + k - FIRST_STEP[b], g, bl, ALPHA)


# Row k is the colour of step k; row 0 is dry (transparent).
_LUT = np.array([(0, 0, 0, 0)] + [_step_colour(k) for k in range(1, MAX_STEP + 1)], dtype=np.uint8)


def profile_surface(levels, station_dist_km, coast_dist_km, sea_level=0.8):
    """Water level by distance from the sea: sea level at the coast, each station's level at its own
    distance, linear in between, the furthest station's level beyond it. On a delta plain levels
    fall towards the sea, which a 2-D interpolation between stations does not respect."""
    order = sorted(levels, key=lambda k: station_dist_km[k])
    xp = [0.0] + [float(station_dist_km[k]) for k in order]
    fp = [sea_level] + [float(levels[k]) for k in order]
    return np.interp(coast_dist_km, xp, fp).astype("float32")


def flood_depth(surface, dem, channel):
    """Depth where the surface is above ground, kept only for 8-connected wet areas touching a channel."""
    raw = np.where(np.isnan(dem), 0.0, surface - np.nan_to_num(dem, nan=0.0))
    wet = raw > 0
    labels, _ = ndimage.label(wet, structure=np.ones((3, 3), bool))
    keep_ids = np.unique(labels[channel & wet])
    keep = np.isin(labels, keep_ids[keep_ids > 0])
    return np.where(keep, raw, 0.0).astype("float32")


def above_baseline(depth, baseline):
    """Flood is new water: cells already wet in the pre-flood state (river beds, ponds, low fields the
    bathtub wets even below BD1) are background water, not flood."""
    return np.where(baseline > 0, 0.0, depth).astype("float32")


def depth_rgba(depth, max_m=None):
    """H x W x 4 uint8 image: banded blues by depth in 0.25 m steps, transparent where dry."""
    k = np.where(depth > 0, np.clip(np.round(depth / STEP_M), 1, MAX_STEP), 0).astype(np.intp)
    return _LUT[k]


def depth_of_rgba(rgba):
    """The depth a frame pixel encodes (to 0.25 m), or None for dry or a colour no step uses."""
    r, g, b, a = (int(v) for v in rgba)
    if a == 0:
        return None
    for i, (_, (br, bg, bb)) in enumerate(BANDS):
        off = r - br
        if (g, b) == (bg, bb) and 0 <= off and _band_of_step(FIRST_STEP[i] + off) == i:
            return (FIRST_STEP[i] + off) * STEP_M
    return None
