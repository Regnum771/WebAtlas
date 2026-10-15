"""
Flood depth on a grid: a planar ("bathtub") approximation, not a hydraulic model.

A water surface is interpolated from station levels by distance from the sea, ground is subtracted, and only water that
connects to a river channel is kept, so closed hollows far from the river stay dry.
"""
import numpy as np
from scipy import ndimage

# Colour ramp stops (depth in metres -> RGB); dry cells are transparent.
RAMP = [(0.0, (0xC6, 0xDB, 0xEF)), (1.5, (0x42, 0x92, 0xC6)), (4.0, (0x08, 0x30, 0x6B))]
ALPHA = 190


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


def depth_rgba(depth, max_m=4.0):
    """H x W x 4 uint8 image: continuous blue ramp by depth, transparent where dry."""
    d = np.clip(depth, 0.0, max_m)
    stops = np.array([s for s, _ in RAMP])
    out = np.zeros(depth.shape + (4,), dtype=np.uint8)
    for band in range(3):
        values = np.array([rgb[band] for _, rgb in RAMP], dtype="float64")
        out[..., band] = np.round(np.interp(d, stops, values)).astype(np.uint8)
    out[..., 3] = np.where(depth > 0, ALPHA, 0).astype(np.uint8)
    return out
