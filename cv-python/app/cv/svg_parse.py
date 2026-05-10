"""SVG path parser for GADM administrative division boundaries.

PostGIS ST_AsSVG returns SVG path strings. This module parses them into
numpy arrays of [x, y] points for use in the CV pipeline.
"""

import re

import numpy as np


def parse_svg_path_points(svg_path: str) -> np.ndarray:
    """Parse SVG path string into Nx2 array of [x, y] points.

    Handles M (moveto), L (lineto), Z (close) commands.
    Strips command characters, splits by whitespace, and parses
    consecutive x,y pairs.

    Args:
        svg_path: SVG path string, e.g. "M 1.0 2.0 L 3.0 4.0 5.0 6.0 Z"

    Returns:
        Numpy array of shape (N, 2) with [x, y] columns.
        Returns empty (0, 2) array if no valid points.
    """
    if not svg_path or not svg_path.strip():
        return np.empty((0, 2), dtype=np.float64)

    # Remove command characters (M, L, Z and lowercase variants)
    cleaned = re.sub(r"[MmLlZz]", " ", svg_path)

    # Split by whitespace and commas, filter empty strings
    tokens = re.split(r"[\s,]+", cleaned.strip())
    tokens = [t for t in tokens if t]

    if not tokens:
        return np.empty((0, 2), dtype=np.float64)

    # Parse tokens into floats, skip NaN values
    values = []
    for token in tokens:
        try:
            val = float(token)
            if not np.isnan(val):
                values.append(val)
        except ValueError:
            continue

    # Pair up consecutive values as (x, y)
    if len(values) < 2:
        return np.empty((0, 2), dtype=np.float64)

    # Truncate to even count
    n_pairs = len(values) // 2
    return np.array(values[: n_pairs * 2], dtype=np.float64).reshape(-1, 2)


def parse_svg_sub_paths(svg_path: str) -> list[np.ndarray]:
    """Split SVG path into separate sub-paths (one per M command).

    Handles multipolygons encoded as M...Z M...Z sequences, as produced
    by PostGIS ST_AsSVG for MULTIPOLYGON geometries.

    Args:
        svg_path: SVG path string potentially containing multiple M...Z segments.

    Returns:
        List of Nx2 numpy arrays, one per sub-path with >= 2 points.
    """
    if not svg_path or not svg_path.strip():
        return []

    # Split at each M/m command using lookahead so the M is kept in each segment
    segments = re.split(r"(?=[Mm])", svg_path.strip())
    segments = [s.strip() for s in segments if s.strip()]

    result = []
    for segment in segments:
        points = parse_svg_path_points(segment)
        if len(points) >= 2:
            result.append(points)

    return result


def resample_path(points: np.ndarray, target_count: int) -> np.ndarray:
    """Resample a polyline to target_count evenly-spaced points.

    Uses arc-length parameterization: computes cumulative segment lengths,
    then interpolates at evenly-spaced arc positions.

    Args:
        points: Nx2 array of [x, y] points.
        target_count: Desired number of output points.

    Returns:
        Numpy array of shape (target_count, 2) with resampled points.
        Returns input unchanged if < 2 points or target_count < 2.
    """
    if len(points) < 2 or target_count < 2:
        return points

    # Compute segment lengths
    diffs = np.diff(points, axis=0)
    seg_lengths = np.sqrt((diffs**2).sum(axis=1))

    # Cumulative arc length, starting at 0
    cumlen = np.concatenate(([0.0], np.cumsum(seg_lengths)))
    total_length = cumlen[-1]

    if total_length == 0.0:
        # All points are identical — return copies of the first point
        return np.tile(points[0], (target_count, 1))

    # Evenly-spaced arc positions
    target_arc = np.linspace(0.0, total_length, target_count)

    # For each target arc position, find the surrounding segment
    indices = np.searchsorted(cumlen, target_arc, side="right")
    # Clamp to valid segment indices
    indices = np.clip(indices, 1, len(points) - 1)

    # Interpolation fractions within each segment
    seg_start = cumlen[indices - 1]
    seg_end = cumlen[indices]
    seg_len = seg_end - seg_start

    # Avoid division by zero for zero-length segments
    with np.errstate(invalid="ignore", divide="ignore"):
        t = np.where(seg_len > 0, (target_arc - seg_start) / seg_len, 0.0)

    # Interpolate
    p0 = points[indices - 1]
    p1 = points[indices]
    return p0 + t[:, np.newaxis] * (p1 - p0)
