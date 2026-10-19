"""The matching pipeline's entry point, held to the answers it gave before it was split (#1654).

Each case draws a country of six GADM divisions the way a Wikivoyage map would
colour it: one cluster per division, two divisions sharing a colour, one
division painted half in a neighbour's colour, so the vote finds a split. The
map is drawn plain, in a conic projection, or tilted, and the matching assigns
every division its cluster. Each case holds the whole answer recorded from the
function as it stood before the split, the debug image by its pixels' digest.
"""

import base64
import hashlib
import math
from collections.abc import Callable

import cv2
import numpy as np
import pytest
from pyproj import CRS, Transformer

from app.cv import match
from app.cv.match import run_matching

TW, TH = 320, 240
Draw = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]


def _grid(lon0: float, lat0: float, lon1: float, lat1: float) -> list[list[tuple[float, float]]]:
    """Six divisions, three across and two down, with a wobbly outer coast."""
    xs = np.linspace(lon0, lon1, 4)
    ys = np.linspace(lat0, lat1, 3)
    cells = []
    for r in range(2):
        for c in range(3):
            x0, x1, y0, y1 = xs[c], xs[c + 1], ys[r], ys[r + 1]
            ring = []
            for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
                ring.append((float(x), float(y)))
            # Densify so a projection bends the edges
            dense = []
            for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1], strict=True):
                for t in np.linspace(0.0, 1.0, 8, endpoint=False):
                    dense.append((ax + (bx - ax) * t, ay + (by - ay) * t))
            cells.append(dense)
    return cells


def _svg(polygon: list[tuple[float, float]]) -> str:
    return "M " + " L ".join(f"{x} {-y}" for x, y in polygon) + " Z"


# Division 1 and division 4 share a colour; division 2 is half painted in division 5's
CLUSTER_OF = [0, 1, 2, 3, 1, 4]


def _drawn(cells: list[list[tuple[float, float]]], draw: Draw) -> np.ndarray:
    """The cluster labels a map drawn through `draw` leaves: TH×TW, 255 off the country."""
    pts_all = [np.array(draw(np.array([p[0] for p in cell]), np.array([p[1] for p in cell]))).T for cell in cells]
    stacked = np.vstack(pts_all)
    lo, hi = stacked.min(axis=0), stacked.max(axis=0)
    scale = min((TW - 40) / (hi[0] - lo[0]), (TH - 40) / (hi[1] - lo[1]))
    labels = np.full((TH, TW), 255, np.uint8)
    for i, pts in enumerate(pts_all):
        px = ((pts - lo) * scale + 20).astype(np.int32)
        cv2.fillPoly(labels, [px], CLUSTER_OF[i])
        if i == 2:
            half = px.copy()
            half[:, 1] = np.minimum(half[:, 1], int(px[:, 1].mean()))
            cv2.fillPoly(labels, [half], CLUSTER_OF[5])
    return labels


def _plain(cos_lat: float) -> Draw:
    return lambda lon, lat: (lon * cos_lat, -lat)


def _crs(spec: str) -> Draw:
    transformer = Transformer.from_crs("EPSG:4326", CRS.from_user_input(spec), always_xy=True)

    def draw(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        e, n = transformer.transform(lon, lat)
        return np.asarray(e), -np.asarray(n)

    return draw


def _tilted(cos_lat: float, px: float) -> Draw:
    def draw(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        x, y = lon * cos_lat, -lat
        w = 1 + px * (x - float(np.mean(x))) * 10
        return x / w, y / w

    return draw


def _stretched(cos_lat: float) -> Draw:
    return lambda lon, lat: (lon * cos_lat * 2.2, -lat)


SMALL = (10.0, 44.0, 22.0, 50.0)
# (box, how the map draws it, the tilt warped over the drawn map, a far island division)
CASES: dict[str, tuple[tuple[float, float, float, float], Callable[[float], Draw], tuple[float, float], bool]] = {
    "a small country drawn plain": (SMALL, _plain, (0.0, 0.0), False),
    "a tall country drawn in a conic projection": (
        (-110.0, 30.0, -80.0, 50.0),
        lambda _cos: _crs("+proj=lcc +lat_1=33 +lat_2=45 +lat_0=40 +lon_0=-95 +datum=WGS84 +no_defs"),
        (0.0, 0.0),
        False,
    ),
    "a small country drawn with its far edge bent": (SMALL, lambda cos: _tilted(cos, 0.004), (0.0, 0.0), False),
    "a small country whose map is tilted hard: the centroid fallback wins": (SMALL, _plain, (0.012, -0.008), False),
    "a small country drawn twice as wide": (SMALL, _stretched, (0.0, 0.0), False),
    "a small country with a far island the map leaves out": (SMALL, _plain, (0.0, 0.0), True),
}
# The alignment's own perspective and conic answer, which a convex country rarely
# draws out of it: the case that holds what the matching does with them.
ALIGNMENT_WARP = "a small country the alignment answers with a perspective warp and a conic term"
CASES[ALIGNMENT_WARP] = (SMALL, _plain, (0.002, 0.001), False)


def _with_a_warp(real: Callable[..., tuple]) -> Callable[..., tuple]:
    def aligned(*args: object, **kwargs: object) -> tuple:
        m, f2, _, _, _, cx = real(*args, **kwargs)
        tilt = np.array([[1, 0, -TW / 2], [0, 1, -TH / 2], [0, 0, 1]], dtype=np.float64)
        warp = (
            np.array([[1, 0, TW / 2], [0, 1, TH / 2], [0, 0, 1]], dtype=np.float64)
            @ np.array([[1, 0, 0], [0, 1, 0], [-0.002, -0.001, 1]], dtype=np.float64)
            @ tilt
        )
        return m, f2, "iou_perspective", warp, 0.004, cx

    return aligned


def _tilt(labels: np.ndarray, tilt: tuple[float, float]) -> np.ndarray:
    to_centre = np.array([[1, 0, -TW / 2], [0, 1, -TH / 2], [0, 0, 1]], dtype=np.float64)
    persp = np.array([[1, 0, 0], [0, 1, 0], [tilt[0], tilt[1], 1]], dtype=np.float64)
    back = np.array([[1, 0, TW / 2], [0, 1, TH / 2], [0, 0, 1]], dtype=np.float64)
    return cv2.warpPerspective(
        labels,
        back @ persp @ to_centre,
        (TW, TH),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=255,
    )


def _inputs(box: tuple[float, float, float, float], draw: Draw, tilt: tuple[float, float], far_island: bool) -> dict:
    cells = _grid(*box)
    labels = _drawn(cells, draw)
    if tilt != (0.0, 0.0):
        labels = _tilt(labels, tilt)
    mask = (labels < 255).astype(np.uint8)
    division_paths = [{"id": 100 + i, "svgPath": _svg(cell)} for i, cell in enumerate(cells)]
    division_paths.append({"id": 199, "svgPath": ""})
    centroids = [
        {"id": 100 + i, "cx": float(np.mean([p[0] for p in cell])), "cy": float(np.mean([p[1] for p in cell]))}
        for i, cell in enumerate(cells)
    ]
    if far_island:
        island = [(box[2] + 25, box[1]), (box[2] + 26, box[1]), (box[2] + 26, box[1] + 1), (box[2] + 25, box[1] + 1)]
        division_paths.append({"id": 150, "svgPath": _svg(island)})
        centroids.append({"id": 150, "cx": box[2] + 25.5, "cy": box[1] + 0.5})
    outline = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
    country = [
        (x, y)
        for (ax, ay), (bx, by) in zip(outline, outline[1:] + outline[:1], strict=True)
        for x, y in [(ax + (bx - ax) * t, ay + (by - ay) * t) for t in np.linspace(0, 1, 16, endpoint=False)]
    ]
    islets = [
        [(box[0] + 1 + d, box[1] + 0.5), (box[0] + 1.4 + d, box[1] + 0.5), (box[0] + 1.2 + d, box[1] + 0.8)]
        for d in (0.0, 2.0)
    ]
    return {
        "pixel_labels": labels,
        "icp_mask": mask.copy(),
        "country_mask": mask,
        "division_paths": division_paths,
        "centroids": centroids,
        "color_centroids": [[200, 60, 60], [60, 200, 60], [60, 60, 200], [200, 200, 60], [60, 200, 200]],
        "country_path": " ".join(_svg(p) for p in [country, *islets]),
        "country_bbox": {"minX": box[0], "minY": box[1], "maxX": box[2], "maxY": box[3]},
        "tw": TW,
        "th": TH,
        "orig_w": TW * 2,
        "orig_h": TH * 2,
    }


def _pixels_digest(image: dict) -> tuple[str, str]:
    """The debug image's label and a digest of its pixels, which a PNG encoder's version cannot move."""
    png = base64.b64decode(image["dataUrl"].split(",", 1)[1])
    pixels = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_UNCHANGED)
    return image["label"], hashlib.sha256(repr(pixels.shape).encode() + pixels.tobytes()).hexdigest()


def _answer(result: dict) -> dict:
    """The result with each debug image replaced by its pixels' digest."""
    return {
        **{k: v for k, v in result.items() if k != "debugImages"},
        "debugImages": [list(_pixels_digest(img)) for img in result["debugImages"]],
    }


# Recorded from run_matching before #1654 split it.
EXPECTED: dict[str, dict] = {
    "a small country drawn plain": {
        "transform": {
            "matrix": [[36.55922769528132, 0.0, -244.33333333333337], [0.0, 33.333333333333336, 1686.6666666666667]],
            "cosLat": 0.6819983600624985,
            "sx": 36.55922769528132,
            "sy": 33.333333333333336,
        },
        "divAssignments": [
            {"divisionId": 100, "clusterId": 0, "confidence": 0.9901, "isSplit": False},
            {"divisionId": 101, "clusterId": 1, "confidence": 0.901, "isSplit": False},
            {
                "divisionId": 102,
                "clusterId": 2,
                "confidence": 0.505,
                "isSplit": True,
                "splitClusters": [{"clusterId": 2, "share": 0.505}, {"clusterId": 4, "share": 0.495}],
            },
            {"divisionId": 103, "clusterId": 3, "confidence": 1.0, "isSplit": False},
            {"divisionId": 104, "clusterId": 1, "confidence": 0.901, "isSplit": False},
            {"divisionId": 105, "clusterId": 4, "confidence": 1.0, "isSplit": False},
        ],
        "outOfBounds": [199],
        "alignmentMethod": "iou_align",
        "alignmentError": 3.05,
        "alignmentErrorMean": 6.64,
        "alignmentPct": 0.6288,
        "inlierRatio": 0.997,
        "debugImages": [["gadm_alignment", "62cfe6c1f4bca745d33765f513e1a4fe0ba7656e71fc9adae4d559299d4062ad"]],
        "steps": [
            "Computing cosine latitude correction",
            "Extracting CV border points",
            "Preparing GADM boundary points",
            "IoU shape alignment",
            "Rasterizing divisions and computing assignments",
            "Generating debug images",
        ],
    },
    "a tall country drawn in a conic projection": {
        "transform": {
            "matrix": [[9.656842300000001, 0.0, 847.9646794318378], [0.0, 9.656842300000001, 507.173692]],
            "cosLat": 0.766044443118978,
            "sx": 9.656842300000001,
            "sy": 9.656842300000001,
        },
        "divAssignments": [
            {"divisionId": 100, "clusterId": 0, "confidence": 0.9785, "isSplit": False},
            {"divisionId": 101, "clusterId": 1, "confidence": 0.9772, "isSplit": False},
            {
                "divisionId": 102,
                "clusterId": 2,
                "confidence": 0.5017,
                "isSplit": True,
                "splitClusters": [{"clusterId": 2, "share": 0.5017}, {"clusterId": 4, "share": 0.4983}],
            },
            {"divisionId": 103, "clusterId": 3, "confidence": 0.9901, "isSplit": False},
            {"divisionId": 104, "clusterId": 1, "confidence": 0.9791, "isSplit": False},
            {"divisionId": 105, "clusterId": 4, "confidence": 0.9996, "isSplit": False},
        ],
        "outOfBounds": [199],
        "alignmentMethod": "iou_align",
        "alignmentError": 0.8,
        "alignmentErrorMean": 2.06,
        "alignmentPct": 0.95,
        "inlierRatio": 0.9966,
        "debugImages": [["gadm_alignment", "7082b13eefbca5a0a9ed6a18865fce9118f1a748a4796d734792606b49641e9f"]],
        "steps": [
            "Computing cosine latitude correction",
            "Detecting map projection",
            "IoU alignment in lcc_p0.08 space",
            "Building inverse projection warp",
            "Applying inverse projection warp to cluster image",
            "Extracting CV border points",
            "Preparing GADM boundary points",
            "IoU shape alignment",
            "Rasterizing divisions and computing assignments",
            "Generating debug images",
        ],
    },
    "a small country drawn with its far edge bent": {
        "transform": {
            "matrix": [[15.273741517079428, 0.0, -84.16666666666667], [0.0, 30.000000000000004, 1529.0000000000002]],
            "cosLat": 0.6819983600624985,
            "sx": 15.273741517079428,
            "sy": 30.000000000000004,
        },
        "divAssignments": [
            {
                "divisionId": 100,
                "clusterId": 0,
                "confidence": 0.7567,
                "isSplit": True,
                "splitClusters": [{"clusterId": 0, "share": 0.7567}, {"clusterId": 3, "share": 0.2433}],
            },
            {"divisionId": 101, "clusterId": 1, "confidence": 1.0, "isSplit": False},
            {
                "divisionId": 102,
                "clusterId": 4,
                "confidence": 0.5529,
                "isSplit": True,
                "splitClusters": [{"clusterId": 4, "share": 0.5529}, {"clusterId": 2, "share": 0.4471}],
            },
            {
                "divisionId": 103,
                "clusterId": 3,
                "confidence": 0.8162,
                "isSplit": True,
                "splitClusters": [{"clusterId": 3, "share": 0.8162}, {"clusterId": 0, "share": 0.1838}],
            },
            {"divisionId": 104, "clusterId": 1, "confidence": 1.0, "isSplit": False},
            {"divisionId": 105, "clusterId": 4, "confidence": 1.0, "isSplit": False},
        ],
        "outOfBounds": [199],
        "alignmentMethod": "iou_align",
        "alignmentError": 7.21,
        "alignmentErrorMean": 8.22,
        "alignmentPct": 0.5275,
        "inlierRatio": 0.9626,
        "debugImages": [["gadm_alignment", "011c71f97c90443b546829e3906ada2e93d1270540b12530a70de1a6c1002451"]],
        "steps": [
            "Computing cosine latitude correction",
            "Extracting CV border points",
            "Preparing GADM boundary points",
            "IoU shape alignment",
            "Rasterizing divisions and computing assignments",
            "Generating debug images",
        ],
    },
    "a small country whose map is tilted hard: the centroid fallback wins": {
        "transform": {
            "matrix": [[50.494989455464584, 0.0, -412.4999999999999], [0.0, 72.42424242424251, 3514.439393939397]],
            "cosLat": 0.6819983600624985,
            "sx": 50.494989455464584,
            "sy": 72.42424242424251,
        },
        "divAssignments": [
            {"divisionId": 100, "clusterId": 1, "confidence": 0.9003, "isSplit": False},
            {
                "divisionId": 101,
                "clusterId": 1,
                "confidence": 0.9356,
                "isSplit": True,
                "splitClusters": [{"clusterId": 1, "share": 0.9356}],
            },
            {
                "divisionId": 102,
                "clusterId": 2,
                "confidence": 0.8171,
                "isSplit": True,
                "splitClusters": [{"clusterId": 2, "share": 0.8171}, {"clusterId": 4, "share": 0.138}],
            },
            {"divisionId": 103, "clusterId": 3, "confidence": 0.9513, "isSplit": False},
            {
                "divisionId": 104,
                "clusterId": 1,
                "confidence": 0.6988,
                "isSplit": True,
                "splitClusters": [{"clusterId": 1, "share": 0.6988}, {"clusterId": 3, "share": 0.2376}],
            },
            {"divisionId": 105, "clusterId": 0, "confidence": 0.9998, "isSplit": False},
        ],
        "outOfBounds": [199],
        "alignmentMethod": "centroid_grid",
        "alignmentError": 18.66,
        "alignmentErrorMean": 22.22,
        "alignmentPct": 0.2698,
        "inlierRatio": 0.9963,
        "debugImages": [["gadm_alignment", "86e859f4d3c484eade8c5b36995f6d2bcb71b3fc381ce633fc8cccd89bd07a98"]],
        "steps": [
            "Computing cosine latitude correction",
            "Extracting CV border points",
            "Preparing GADM boundary points",
            "IoU shape alignment",
            "Centroid fallback (IoU alignment had poor centroid coverage)",
            "Rasterizing divisions and computing assignments",
            "Generating debug images",
        ],
    },
    "a small country drawn twice as wide": {
        "transform": {
            "matrix": [[37.634499098083715, 0.0, -251.66666666666674], [0.0, 15.5, 795.0]],
            "cosLat": 0.6819983600624985,
            "sx": 37.634499098083715,
            "sy": 15.5,
        },
        "divAssignments": [
            {"divisionId": 100, "clusterId": 0, "confidence": 0.9792, "isSplit": False},
            {
                "divisionId": 101,
                "clusterId": 1,
                "confidence": 0.8942,
                "isSplit": True,
                "splitClusters": [{"clusterId": 1, "share": 0.8942}],
            },
            {
                "divisionId": 102,
                "clusterId": 4,
                "confidence": 0.5,
                "isSplit": True,
                "splitClusters": [{"clusterId": 4, "share": 0.5}, {"clusterId": 2, "share": 0.5}],
            },
            {"divisionId": 103, "clusterId": 3, "confidence": 1.0, "isSplit": False},
            {
                "divisionId": 104,
                "clusterId": 1,
                "confidence": 0.8942,
                "isSplit": True,
                "splitClusters": [{"clusterId": 1, "share": 0.8942}],
            },
            {"divisionId": 105, "clusterId": 4, "confidence": 1.0, "isSplit": False},
        ],
        "outOfBounds": [199],
        "alignmentMethod": "iou_align",
        "alignmentError": 2.42,
        "alignmentErrorMean": 6.12,
        "alignmentPct": 0.6462,
        "inlierRatio": 0.997,
        "debugImages": [["gadm_alignment", "1a238c4d0c5daf451ba82c6f596894ded48754013aeb2066a029fc3d148ba695"]],
        "steps": [
            "Computing cosine latitude correction",
            "Extracting CV border points",
            "Preparing GADM boundary points",
            "IoU shape alignment",
            "Rasterizing divisions and computing assignments",
            "Generating debug images",
        ],
    },
    "a small country with a far island the map leaves out": {
        "transform": {
            "matrix": [[36.55922769528132, 0.0, -244.33333333333337], [0.0, 33.333333333333336, 1686.6666666666667]],
            "cosLat": 0.6819983600624985,
            "sx": 36.55922769528132,
            "sy": 33.333333333333336,
        },
        "divAssignments": [
            {"divisionId": 100, "clusterId": 0, "confidence": 0.9901, "isSplit": False},
            {"divisionId": 101, "clusterId": 1, "confidence": 0.901, "isSplit": False},
            {
                "divisionId": 102,
                "clusterId": 2,
                "confidence": 0.505,
                "isSplit": True,
                "splitClusters": [{"clusterId": 2, "share": 0.505}, {"clusterId": 4, "share": 0.495}],
            },
            {"divisionId": 103, "clusterId": 3, "confidence": 1.0, "isSplit": False},
            {"divisionId": 104, "clusterId": 1, "confidence": 0.901, "isSplit": False},
            {"divisionId": 105, "clusterId": 4, "confidence": 1.0, "isSplit": False},
        ],
        "outOfBounds": [199, 150],
        "alignmentMethod": "iou_align",
        "alignmentError": 3.05,
        "alignmentErrorMean": 6.64,
        "alignmentPct": 0.6288,
        "inlierRatio": 0.997,
        "debugImages": [["gadm_alignment", "62cfe6c1f4bca745d33765f513e1a4fe0ba7656e71fc9adae4d559299d4062ad"]],
        "steps": [
            "Computing cosine latitude correction",
            "Extracting CV border points",
            "Preparing GADM boundary points",
            "IoU shape alignment",
            "Rasterizing divisions and computing assignments",
            "Generating debug images",
        ],
    },
    "a small country the alignment answers with a perspective warp and a conic term": {
        "transform": {
            "matrix": [[38.4499, 0.0, -269.8103072262745], [0.0, 38.4499, 1927.1353]],
            "cosLat": 0.6819983600624985,
            "sx": 38.4499,
            "sy": 38.4499,
        },
        "divAssignments": [
            {"divisionId": 100, "clusterId": 0, "confidence": 0.9891, "isSplit": False},
            {
                "divisionId": 101,
                "clusterId": 1,
                "confidence": 0.8546,
                "isSplit": True,
                "splitClusters": [{"clusterId": 1, "share": 0.8546}, {"clusterId": 0, "share": 0.1243}],
            },
            {
                "divisionId": 102,
                "clusterId": 4,
                "confidence": 0.5003,
                "isSplit": True,
                "splitClusters": [{"clusterId": 4, "share": 0.5003}, {"clusterId": 2, "share": 0.4997}],
            },
            {
                "divisionId": 103,
                "clusterId": 0,
                "confidence": 0.5836,
                "isSplit": True,
                "splitClusters": [{"clusterId": 0, "share": 0.5836}, {"clusterId": 3, "share": 0.4164}],
            },
            {
                "divisionId": 104,
                "clusterId": 1,
                "confidence": 0.7801,
                "isSplit": True,
                "splitClusters": [
                    {"clusterId": 1, "share": 0.7801},
                    {"clusterId": 3, "share": 0.106},
                    {"clusterId": 0, "share": 0.1023},
                ],
            },
            {"divisionId": 105, "clusterId": 4, "confidence": 0.9996, "isSplit": False},
        ],
        "outOfBounds": [199],
        "alignmentMethod": "iou_perspective",
        "alignmentError": 15.35,
        "alignmentErrorMean": 19.61,
        "alignmentPct": 0.1375,
        "inlierRatio": 0.9961,
        "debugImages": [["gadm_alignment", "14b81a257a57b869d71c6c11b025ba3953fe7dd40c0ade1acfcc0dbc6316f847"]],
        "steps": [
            "Computing cosine latitude correction",
            "Extracting CV border points",
            "Preparing GADM boundary points",
            "IoU shape alignment",
            "Applying inverse perspective warp to cluster image",
            "Rasterizing divisions and computing assignments",
            "Generating debug images",
        ],
    },
}


@pytest.mark.parametrize("case", list(CASES))
def test_the_matching_answers_as_it_did_before_the_split(case: str, monkeypatch: pytest.MonkeyPatch) -> None:
    if case == ALIGNMENT_WARP:
        monkeypatch.setattr(match, "iou_alignment", _with_a_warp(match.iou_alignment))
    box, draw_for, tilt, far_island = CASES[case]
    cos_lat = math.cos(math.radians((box[1] + box[3]) / 2))
    steps: list[str] = []
    got = _answer(run_matching(**_inputs(box, draw_for(cos_lat), tilt, far_island), on_progress=steps.append))
    want = EXPECTED[case]

    np.testing.assert_allclose(got["transform"]["matrix"], want["transform"]["matrix"], rtol=1e-9, atol=1e-9)
    for key in ("cosLat", "sx", "sy"):
        assert got["transform"][key] == pytest.approx(want["transform"][key], rel=1e-9)
    rest = (
        "divAssignments",
        "outOfBounds",
        "alignmentMethod",
        "alignmentError",
        "alignmentErrorMean",
        "alignmentPct",
        "inlierRatio",
        "debugImages",
    )
    assert {k: got[k] for k in rest} == {k: want[k] for k in rest}
    assert steps == want["steps"]
