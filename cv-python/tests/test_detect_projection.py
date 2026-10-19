"""Projection detection, held to the answers it gave before it was split (#1654).

Each case draws a region as GADM's SVG gives it (x = longitude, y = minus
latitude), and a mask of the same region as a map in some projection would draw
it. The detection names the projection whose outline best matches the mask's
convex hull, or None when the equirectangular baseline is not beaten by 5%. The
expected names, and where each named projection sends a few points, were recorded
from the function as it stood before the split.
"""

import math

import cv2
import numpy as np
import pytest
from pyproj import CRS, Transformer

from app.cv.match import _detect_projection

TW, TH = 320, 240


def _ring(lon0: float, lat0: float, lon1: float, lat1: float, wobble: float) -> list[tuple[float, float]]:
    """An irregular outline inside the box, a vertex every few degrees."""
    pts = []
    for i in range(24):
        a = 2 * math.pi * i / 24
        r = 1 + wobble * math.sin(3 * a) + 0.5 * wobble * math.cos(5 * a)
        lon = (lon0 + lon1) / 2 + (lon1 - lon0) / 2 * r * math.cos(a)
        lat = (lat0 + lat1) / 2 + (lat1 - lat0) / 2 * r * math.sin(a)
        pts.append((lon, lat))
    return pts


def _islands(lon: float, lat: float) -> list[list[tuple[float, float]]]:
    return [[(lon + d, lat), (lon + d + 0.6, lat), (lon + d + 0.3, lat + 0.5)] for d in (0.0, 1.5)]


def _svg(polygons: list[list[tuple[float, float]]]) -> str:
    return " ".join("M " + " L ".join(f"{x} {-y}" for x, y in polygon) + " Z" for polygon in polygons)


def _drawn(polygons: list[list[tuple[float, float]]], crs: str | None) -> np.ndarray:
    """The region drawn into a TH×TW mask through crs, or through lon·cos(lat) when None."""
    projected = []
    for polygon in polygons:
        lon = np.array([p[0] for p in polygon], dtype=np.float64)
        lat = np.array([p[1] for p in polygon], dtype=np.float64)
        if crs is None:
            mid = math.radians(float(np.mean(lat)))
            x, y = lon * math.cos(mid), lat
        else:
            x, y = Transformer.from_crs("EPSG:4326", CRS.from_user_input(crs), always_xy=True).transform(lon, lat)
        projected.append(np.column_stack([x, -np.asarray(y)]))
    stacked = np.vstack(projected)
    lo, hi = stacked.min(axis=0), stacked.max(axis=0)
    scale = min((TW - 40) / (hi[0] - lo[0]), (TH - 40) / (hi[1] - lo[1]))
    mask = np.zeros((TH, TW), np.uint8)
    for pts in projected:
        cv2.fillPoly(mask, [((pts - lo) * scale + 20).astype(np.int32)], 1)
    return mask


def _centroids(lon0: float, lat0: float, lon1: float, lat1: float) -> list[dict]:
    return [
        {"id": f"d{i}", "cx": lon0 + (lon1 - lon0) * fx, "cy": lat0 + (lat1 - lat0) * fy}
        for i, (fx, fy) in enumerate([(0.3, 0.3), (0.5, 0.5), (0.7, 0.4), (0.4, 0.7), (0.6, 0.65)])
    ]


# A region the shape of the lower 48 states, of Alaska, and of a country at mid
# latitudes, each with two islets so it has the three sub-paths the detection asks for.
CONUS = (-123.0, 27.0, -70.0, 48.0)
ALASKA = (-165.0, 56.0, -142.0, 70.0)
MIDLAT = (5.0, 44.0, 25.0, 56.0)


def _region(box: tuple[float, float, float, float], wobble: float = 0.12) -> list[list[tuple[float, float]]]:
    return [_ring(*box, wobble), *_islands(box[0] + 2, box[1] + 1)]


CASES = {
    "a mid-latitude country drawn plain: equirectangular stands": (MIDLAT, None),
    "the lower 48 drawn in Conus Albers": (CONUS, "EPSG:5070"),
    "Alaska drawn in Alaska Albers": (ALASKA, "EPSG:3338"),
    "a mid-latitude country drawn in a one-parallel conic": (
        MIDLAT,
        "+proj=lcc +lat_1=62 +lat_0=50 +lon_0=15 +x_0=0 +y_0=0 +datum=WGS84 +no_defs",
    ),
}

# Points the named projection is read at, as GADM SVG gives them.
PROBE_X = np.array([-150.0, -100.0, 10.0, 20.0])
PROBE_Y = np.array([-60.0, -38.0, -48.0, -52.0])

# Recorded from _detect_projection before #1654 split it: the name, and where
# the projection sends the probe points (None when equirectangular stands).
EXPECTED: dict[str, tuple[str, list[float], list[float]] | None] = {
    "a mid-latitude country drawn plain: equirectangular stands": None,
    "the lower 48 drawn in Conus Albers": (
        "epsg5070_conus_albers",
        [-3161648.5406786804, -347822.5176114487, 6422015.381584454, 6306151.071874692],
        [-4976973.318429143, -1670145.86312289, -6783893.349163424, -7625795.248111836],
    ),
    "Alaska drawn in Alaska Albers": (
        "aea_p0.08",
        [195297.2883198405, 4420835.991317141, 2780086.6134161456, 1930854.9018988446],
        [329126.01473025995, 774207.7064443332, -7312220.76134125, -7299329.027236391],
    ),
    "a mid-latitude country drawn in a one-parallel conic": (
        "lcc_lat1_75",
        [-1198746.672974972, -5654654.54733307, -405197.9640762642, 364919.1591927977],
        [-7757720.35880027, -6752109.979543651, 223370.2569517011, -253340.68463355507],
    ),
}


@pytest.mark.parametrize("case", list(CASES))
def test_the_detection_names_the_projection_it_named_before_the_split(case: str) -> None:
    box, crs = CASES[case]
    polygons = _region(box)
    found = _detect_projection(
        _svg(polygons), _drawn(polygons, crs), _centroids(*box), math.cos(math.radians((box[1] + box[3]) / 2)), TW, TH
    )
    want = EXPECTED[case]

    if want is None:
        assert found is None
        return
    assert found is not None
    name, project = found
    px, py = project(PROBE_X, PROBE_Y)
    assert name == want[0]
    np.testing.assert_allclose(px, want[1], rtol=1e-9)
    np.testing.assert_allclose(py, want[2], rtol=1e-9)


def test_an_outline_of_fewer_than_three_paths_is_not_tested() -> None:
    polygons = [_ring(*MIDLAT, 0.12)]
    assert _detect_projection(_svg(polygons), _drawn(polygons, None), _centroids(*MIDLAT), 0.65, TW, TH) is None


def test_a_mask_of_fewer_than_100_pixels_is_not_tested() -> None:
    mask = np.zeros((TH, TW), np.uint8)
    mask[100:109, 100:109] = 1
    assert _detect_projection(_svg(_region(MIDLAT)), mask, _centroids(*MIDLAT), 0.65, TW, TH) is None
