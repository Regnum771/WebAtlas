"""
Flood depth on a grid: a planar ("bathtub") approximation, not a hydraulic model.

A water surface is interpolated from station levels, ground is subtracted, and only water that
connects to a river channel is kept, so closed hollows far from the river stay dry.
"""
import numpy as np
from scipy import ndimage

# Colour ramp stops (depth in metres -> RGB); dry cells are transparent.
RAMP = [(0.0, (0xC6, 0xDB, 0xEF)), (1.5, (0x42, 0x92, 0xC6)), (4.0, (0x08, 0x30, 0x6B))]
ALPHA = 190


def water_surface(levels, station_rc, shape, power=2.0):
    """Inverse-distance-weighted surface (float32) from station levels at fractional (row, col)."""
    rows, cols = np.indices(shape, dtype="float64")
    num = np.zeros(shape)
    den = np.zeros(shape)
    exact = np.full(shape, np.nan)
    for sid, level in levels.items():
        r, c = station_rc[sid]
        dist = np.hypot(rows - r, cols - c)
        on_cell = dist < 0.5
        exact[on_cell] = level
        w = 1.0 / np.maximum(dist, 0.5) ** power
        num += w * level
        den += w
    surface = num / den
    surface[~np.isnan(exact)] = exact[~np.isnan(exact)]
    return surface.astype("float32")


def flood_depth(surface, dem, channel):
    """Depth where the surface is above ground, kept only for 8-connected wet areas touching a channel."""
    raw = np.where(np.isnan(dem), 0.0, surface - np.nan_to_num(dem, nan=0.0))
    wet = raw > 0
    labels, _ = ndimage.label(wet, structure=np.ones((3, 3), bool))
    keep_ids = np.unique(labels[channel & wet])
    keep = np.isin(labels, keep_ids[keep_ids > 0])
    return np.where(keep, raw, 0.0).astype("float32")


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
