"""The decoration CC exclusion, held to the answers it gave before it was split (#1654).

A scene draws a country mask the way a Wikivoyage map leaves one after
preprocessing: a mainland and islands shaded smoothly, as mean-shift leaves land,
and the furniture a map carries near its edges — a title box, a compass, a scale
bar, a text label, stray dots — in flat colours. The exclusion drops whole
connected components, so each shape is either kept or dropped; which ones were
kept was recorded from the function as it stood before the split.
"""

from collections.abc import Callable

import cv2
import numpy as np
import pytest

from app.cv.decoration_ccs import exclude_decoration_ccs

W, H = 400, 300


def _gradient(shape_mask: np.ndarray, base: tuple[int, int, int], spread: int) -> np.ndarray:
    """A smooth shading across the shape's bounding box, as mean-shift leaves land."""
    ys, xs = np.nonzero(shape_mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    fx = np.linspace(0.0, 1.0, x1 - x0)[None, :]
    fy = np.linspace(0.0, 1.0, y1 - y0)[:, None]
    out = np.zeros((H, W, 3), np.float64)
    for c in range(3):
        out[y0:y1, x0:x1, c] = base[c] + spread * (fx if c != 1 else fy) - spread / 2
    return np.clip(out, 0, 255)


def _shape(draw: Callable[[np.ndarray], object]) -> np.ndarray:
    mask = np.zeros((H, W), np.uint8)
    draw(mask)
    return mask


# A map whose land is two thirds of the country mask: every shape that looks
# natural is protected, and the furniture is judged by its size and shape.
FURNISHED: dict[str, tuple[np.ndarray, str]] = {
    "mainland": (
        _shape(
            lambda m: cv2.fillPoly(
                m, [np.array([[110, 80], [250, 60], [300, 140], [270, 230], [150, 240], [100, 160]], np.int32)], 1
            )
        ),
        "land",
    ),
    "an island off the coast": (
        _shape(
            lambda m: cv2.fillPoly(
                m, [np.array([[320, 160], [345, 150], [352, 175], [340, 190], [325, 185], [330, 172]], np.int32)], 1
            )
        ),
        "land",
    ),
    "an islet a pixel's river below the south coast": (
        _shape(lambda m: cv2.rectangle(m, (160, 241), (180, 255), 1, -1)),
        "flat",
    ),
    "a compact island inland": (_shape(lambda m: cv2.circle(m, (180, 150), 7, 1, -1)), "land"),
    "a title box": (_shape(lambda m: cv2.rectangle(m, (8, 8), (95, 55), 1, -1)), "flat"),
    "a compass rose": (_shape(lambda m: cv2.circle(m, (375, 30), 10, 1, -1)), "flat"),
    "a scale bar": (_shape(lambda m: cv2.rectangle(m, (230, 280), (330, 289), 1, -1)), "faint"),
    "a text label": (_shape(lambda m: cv2.rectangle(m, (330, 250), (380, 265), 1, -1)), "striped"),
    "a stray dot": (_shape(lambda m: cv2.circle(m, (15, 285), 2, 1, -1)), "flat"),
    "a legend swatch": (_shape(lambda m: cv2.rectangle(m, (10, 190), (45, 225), 1, -1)), "land"),
    "a medallion": (_shape(lambda m: cv2.ellipse(m, (370, 100), (16, 12), 0, 0, 360, 1, -1)), "flat"),
    "a round mark inland": (_shape(lambda m: cv2.circle(m, (200, 120), 9, 1, -1)), "flat"),
}

# A map whose land is over nine tenths of the mask: protection stops after the
# mainland and its island, and every smaller shape is judged.
SPARE: dict[str, tuple[np.ndarray, str]] = {
    "mainland": (
        _shape(
            lambda m: (
                cv2.fillPoly(
                    m, [np.array([[50, 40], [300, 20], [385, 110], [370, 270], [150, 285], [30, 200]], np.int32)], 1
                ),
                cv2.circle(m, (200, 150), 16, 0, -1),
            )
        ),
        "land",
    ),
    "a square mark in a lake": (_shape(lambda m: cv2.rectangle(m, (194, 144), (207, 157), 1, -1)), "flat"),
    "an islet of a few pixels": (_shape(lambda m: cv2.circle(m, (392, 285), 6, 1, -1)), "land"),
    "a text label": (_shape(lambda m: cv2.rectangle(m, (3, 230), (24, 244), 1, -1)), "striped"),
    "a stray dot": (_shape(lambda m: cv2.circle(m, (392, 8), 1, 1, -1)), "flat"),
    "a cape of the coast": (
        _shape(
            lambda m: cv2.fillPoly(
                m, [np.array([[2, 60], [22, 70], [8, 80], [24, 100], [3, 110], [12, 85]], np.int32)], 1
            )
        ),
        "land",
    ),
    "a cartouche": (_shape(lambda m: cv2.ellipse(m, (330, 6), (28, 5), 0, 0, 360, 1, -1)), "shaded"),
    "an oval badge": (_shape(lambda m: cv2.ellipse(m, (60, 268), (28, 20), 0, 0, 360, 1, -1)), "shaded"),
}

SCENES = {"a furnished map": FURNISHED, "a spare map": SPARE}


def _scene(shapes: dict[str, tuple[np.ndarray, str]]) -> tuple[np.ndarray, np.ndarray]:
    mask = np.zeros((H, W), np.uint8)
    image = np.full((H, W, 3), 235, np.float64)
    rng = np.random.default_rng(1654)
    for i, (shape, paint) in enumerate(shapes.values()):
        mask |= shape
        on = shape > 0
        if paint == "land":
            image[on] = _gradient(shape, (90 + 7 * i, 160, 70), 90)[on]
        elif paint == "shaded":
            image[on] = _gradient(shape, (120, 120, 120), 60)[on]
        elif paint == "flat":
            image[on] = (40 + 15 * i, 60, 140)
        elif paint == "faint":
            image[on] = np.clip(rng.normal((80, 80, 80), 6, (int(on.sum()), 3)), 0, 255)
        else:
            stripes = np.where((np.arange(W) // 3) % 2 == 0, 20, 230)[None, :].repeat(H, axis=0)
            image[on] = np.stack([stripes, stripes, stripes], axis=-1)[on]
    return mask, image.astype(np.uint8)


# Recorded from the exclusion before #1654 split it: the shapes kept.
EXPECTED_KEPT: dict[tuple[str, float], set[str]] = {
    ("a furnished map", 0.25): {
        "a compact island inland",
        "a round mark inland",
        "a stray dot",
        "an island off the coast",
        "mainland",
    },
    ("a furnished map", 0.28): {
        "a compact island inland",
        "a round mark inland",
        "a stray dot",
        "an island off the coast",
        "mainland",
    },
    ("a spare map", 0.25): {"a cape of the coast", "mainland"},
    ("a spare map", 0.28): {"a cape of the coast", "mainland"},
}


@pytest.mark.parametrize("edge_pct", [0.25, 0.28])
@pytest.mark.parametrize("scene", list(SCENES))
def test_the_exclusion_keeps_the_shapes_it_kept_before_the_split(scene: str, edge_pct: float) -> None:
    shapes = SCENES[scene]
    mask, image = _scene(shapes)
    result = exclude_decoration_ccs(mask, image, edge_pct=edge_pct)

    kept = {name for name, (shape, _) in shapes.items() if np.any(result[(shape > 0) & (mask > 0)])}
    assert kept == EXPECTED_KEPT[(scene, edge_pct)]
    for name, (shape, _) in shapes.items():
        part = (shape > 0) & (mask > 0)
        assert np.all(result[part] == (1 if name in kept else 0)), name


def test_an_empty_mask_is_returned_as_it_is() -> None:
    mask = np.zeros((H, W), np.uint8)
    assert exclude_decoration_ccs(mask, np.zeros((H, W, 3), np.uint8)) is mask
