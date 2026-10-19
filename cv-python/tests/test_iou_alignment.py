"""The IoU alignment search, held to the answers it gave before it was split (#1654).

Each case draws a country outline as GADM's SVG gives it (x = longitude, y = minus
latitude), and a CV mask of the same country as a map would draw it: scaled,
shifted, and bent by a conic or a perspective term. The expected transforms were
recorded from the function as it stood before the split, so a case that moves
means the split changed what the search finds.
"""

import math

import cv2
import numpy as np
import pytest

from app.cv.iou_alignment import _search_frame, _shear_search, iou_alignment

TW, TH = 320, 240
MID_LAT = 47.5
COS_LAT = math.cos(math.radians(MID_LAT))

# A country between 9°E and 30°E, 40°N and 55°N, two islands off its coast that
# the map draws, one it leaves out, and one far across the world that is no part
# of the map.
MAINLAND = [
    (10, 41),
    (14, 40),
    (20, 42),
    (27, 40.5),
    (30, 44),
    (28, 49),
    (24, 51),
    (25, 55),
    (18, 54),
    (13, 52),
    (11, 48),
    (9, 45),
]
DRAWN_ISLANDS = [[(15, 44), (16, 44), (16, 44.6), (15, 44.6)], [(20, 47), (21, 47), (21, 47.6), (20, 47.6)]]
UNDRAWN_ISLAND = [(9.6, 49.5), (10.2, 49.5), (10.2, 50.2), (9.6, 50.2)]
FAR_ISLAND = [(70, 20), (71, 20), (71, 21)]

# Division centroids in degrees; the last one sits across the antimeridian, as
# the Aleutians West does for Alaska, and is left out of the extent.
CENTROIDS = [
    {"id": f"d{i}", "cx": x, "cy": y}
    for i, (x, y) in enumerate([(14, 44), (20, 46), (26, 45), (22, 51), (16, 50), (12, 46), (175, 47)])
]


def _svg(polygons: list[list[tuple[float, float]]]) -> str:
    return " ".join("M " + " L ".join(f"{x} {-y}" for x, y in polygon) + " Z" for polygon in polygons)


def _drawn_mask(
    polygons: list[list[tuple[float, float]]],
    scale: tuple[float, float],
    offset: tuple[float, float],
    conic: float = 0.0,
    perspective: tuple[float, float] = (0.0, 0.0),
) -> np.ndarray:
    """The country as a map draws it: a 0/1 mask of TH×TW pixels."""
    mask = np.zeros((TH, TW), np.uint8)
    for polygon in polygons:
        pts = np.array([(x * COS_LAT, -y) for x, y in polygon], dtype=np.float64)
        pts[:, 0] = 20 * COS_LAT + (pts[:, 0] - 20 * COS_LAT) * (1 + conic * (pts[:, 1] + MID_LAT))
        pts[:, 0] = pts[:, 0] * scale[0] + offset[0]
        pts[:, 1] = pts[:, 1] * scale[1] + offset[1]
        cv2.fillPoly(mask, [pts.astype(np.int32)], 1)
    if perspective != (0.0, 0.0):
        to_centre = np.array([[1, 0, -TW / 2], [0, 1, -TH / 2], [0, 0, 1]], dtype=np.float64)
        tilt = np.array([[1, 0, 0], [0, 1, 0], [perspective[0], perspective[1], 1]], dtype=np.float64)
        back = np.array([[1, 0, TW / 2], [0, 1, TH / 2], [0, 0, 1]], dtype=np.float64)
        mask = cv2.warpPerspective(mask, back @ tilt @ to_centre, (TW, TH), flags=cv2.INTER_NEAREST)
    return mask


def _three_corners() -> np.ndarray:
    """Three squares in three corners: no placement of one country covers them."""
    mask = np.zeros((TH, TW), np.uint8)
    mask[10:50, 10:50] = 1
    mask[190:230, 270:310] = 1
    mask[10:50, 270:310] = 1
    return mask


WITH_ISLANDS = _svg([MAINLAND, *DRAWN_ISLANDS, UNDRAWN_ISLAND, FAR_ISLAND])
# 15 × 14 islets of a tenth of a degree inside the mainland, past the 200
# paths the scale search reads.
ISLETS = [
    [(lon, lat), (lon + 0.1, lat), (lon, lat + 0.1)]
    for lon in np.arange(14.0, 21.5, 0.5).tolist()
    for lat in np.arange(43.0, 50.0, 0.5).tolist()
]
DRAWN = [MAINLAND, *DRAWN_ISLANDS]


def _cases() -> dict[str, tuple[str, np.ndarray]]:
    return {
        "a plain map: the affine fit is near-perfect and no refinement runs": (
            WITH_ISLANDS,
            _drawn_mask(DRAWN, (11.0, 13.0), (-60, 760)),
        ),
        "a tilted map: the conic and the perspective searches both improve the fit": (
            WITH_ISLANDS,
            _drawn_mask(DRAWN, (11.0, 13.0), (-60, 760), perspective=(0.004, 0.003)),
        ),
        "a conic and tilted map: the conic search improves the fit, the perspective search does not": (
            WITH_ISLANDS,
            _drawn_mask(DRAWN, (11.0, 13.0), (-60, 760), conic=0.06, perspective=(0.004, 0.003)),
        ),
        "a coast of more islets than the scale search reads: the islets it leaves out change nothing": (
            _svg([MAINLAND, *ISLETS]),
            _drawn_mask(DRAWN, (11.0, 13.0), (-60, 760)),
        ),
        "a mask no placement covers: the affine fit is returned without refinement": (
            _svg([MAINLAND]),
            _three_corners(),
        ),
    }


# Recorded from the search before #1654 split it: (matrix, f2, method,
# inverse homography, k_conic, gadm_cx_corr).
EXPECTED: dict[str, tuple[list[list[float]], float, str, list[list[float]] | None, float, float]] = {
    "a plain map: the affine fit is near-perfect and no refinement runs": (
        [[12.687306452014525, 0.0, -74.14269428571427], [0.0, 13.566419999999999, 788.40495]],
        0.991223394128622,
        "iou_align",
        None,
        0.0,
        12.836213944697546,
    ),
    "a tilted map: the conic and the perspective searches both improve the fit": (
        [[12.623248177680027, 0.0, -98.8918571428571], [0.0, 15.852869999999996, 871.5613249999999]],
        0.8964408628039714,
        "iou_perspective",
        [
            [1.0193194259440819, -0.06178601575683682, 6.350532641755429],
            [0.03687565840630177, 0.8820668886368527, 12.121481925666515],
            [0.00030000000000000003, -0.0009594386903990309, 1.0986136854190653],
        ],
        0.01300000000000001,
        12.836213944697546,
    ),
    "a conic and tilted map: the conic search improves the fit, the perspective search does not": (
        [[13.558303598248916, 0.0, -112.18014285714278], [0.0, 15.852869999999996, 874.5613249999999]],
        0.8927444563478668,
        "iou_align",
        None,
        0.021000000000000026,
        12.836213944697546,
    ),
    "a coast of more islets than the scale search reads: the islets it leaves out change nothing": (
        [[12.687306452014525, 0.0, -74.14269428571427], [0.0, 13.566419999999999, 788.40495]],
        0.991223394128622,
        "iou_align",
        None,
        0.0,
        12.836213944697546,
    ),
    "a mask no placement covers: the affine fit is returned without refinement": (
        [[16.141278999999997, 0.0, 8.6459367891175], [0.0, 16.141278999999997, 897.4357524999999]],
        0.4469168395247972,
        "iou_align",
        None,
        0.0,
        12.836213944697546,
    ),
}


@pytest.mark.parametrize("case", list(_cases()))
def test_the_search_finds_the_transform_it_found_before_the_split(case: str) -> None:
    path, mask = _cases()[case]
    matrix, f2, method, inverse_h, k_conic, gadm_cx_corr = iou_alignment(path, mask, CENTROIDS, COS_LAT, TW, TH)
    want_matrix, want_f2, want_method, want_h, want_k, want_cx = EXPECTED[case]

    assert method == want_method
    np.testing.assert_allclose(matrix, want_matrix, rtol=1e-9, atol=1e-9)
    assert f2 == pytest.approx(want_f2, rel=1e-9)
    assert k_conic == pytest.approx(want_k, abs=1e-12)
    assert gadm_cx_corr == pytest.approx(want_cx, rel=1e-12)
    if want_h is None:
        assert inverse_h is None
    else:
        np.testing.assert_allclose(inverse_h, want_h, rtol=1e-9, atol=1e-12)


def test_an_outline_with_no_path_gives_the_identity() -> None:
    mask = _drawn_mask(DRAWN, (11.0, 13.0), (-60, 760))
    matrix, f2, method, inverse_h, k_conic, gadm_cx_corr = iou_alignment("", mask, CENTROIDS, COS_LAT, TW, TH)

    np.testing.assert_array_equal(matrix, np.eye(2, 3))
    assert (f2, method, inverse_h, k_conic, gadm_cx_corr) == (0.0, "iou_align", None, 0.0, 0.0)


def test_a_mask_of_under_ten_pixels_gives_the_identity() -> None:
    mask = np.zeros((TH, TW), np.uint8)
    mask[100, 100:109] = 1
    matrix, f2, method, inverse_h, k_conic, gadm_cx_corr = iou_alignment(WITH_ISLANDS, mask, CENTROIDS, COS_LAT, TW, TH)

    np.testing.assert_array_equal(matrix, np.eye(2, 3))
    assert (f2, method, inverse_h, k_conic, gadm_cx_corr) == (0.0, "iou_align", None, 0.0, 0.0)


def _sheared(mask: np.ndarray, shear: float) -> np.ndarray:
    """The mask with its columns slid along x in proportion to their height."""
    slide = np.float32([[1, shear, -shear * TH / 2], [0, 1, 0]])
    return cv2.warpAffine(mask, slide, (TW, TH), flags=cv2.INTER_NEAREST)


def test_the_shear_search_keeps_a_shear_only_when_it_raises_f2_by_half_a_percent() -> None:
    # The full search scores the shear unsmoothed against an F2 measured on
    # smoothed shapes, which a drawn map rarely beats; the stage is held here
    # against a baseline of its own.
    mask = _sheared(_drawn_mask(DRAWN, (11.0, 13.0), (-60, 760)), 0.12)
    search = _search_frame(WITH_ISLANDS, mask, CENTROIDS, COS_LAT, TW, TH)
    assert search is not None
    params = (12.687306452014525, 13.566419999999999, -74.14269428571427, 788.40495)

    matrix, f2 = _shear_search(search, 0.5, params)
    assert f2 > 0.5 * 1.005
    assert matrix[0, 1] != 0.0
    assert (matrix[0, 0], matrix[0, 2], matrix[1, 1], matrix[1, 2]) == (params[0], params[2], params[1], params[3])

    matrix, f2 = _shear_search(search, 0.99, params)
    assert f2 == 0.99
    np.testing.assert_array_equal(matrix, [[params[0], 0.0, params[2]], [0.0, params[1], params[3]]])


def test_the_scale_search_draws_the_200_largest_paths_of_a_coast_of_islets() -> None:
    mask = _drawn_mask(DRAWN, (11.0, 13.0), (-60, 760))
    search = _search_frame(_svg([MAINLAND, *ISLETS]), mask, CENTROIDS, COS_LAT, TW, TH)
    assert search is not None

    assert len(search.sub_paths) == 1 + len(ISLETS)
    assert len(search.search_paths) == 200
    assert any(len(sp) == len(MAINLAND) for sp in search.search_paths)
