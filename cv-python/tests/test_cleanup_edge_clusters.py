"""The cleanup's decoration and residue steps, held to the answers they gave before they were split (#1654).

Two drawn cluster maps take the four steps that judge a cluster, or a piece of
one, by its shape and place: the per-cluster edge decoration CCs, the
rectangular edge clusters, the straight-edged clusters and the fragmented
residue merge. A province is shaded smoothly, as mean-shift leaves land; map
furniture is a flat colour. Each step's answer was recorded from the function as
it stood before the split, by how many pixels it changed and the result's digest.
"""

import hashlib
from collections.abc import Callable

import cv2
import numpy as np
import pytest

from app.cv.cleanup import (
    _exclude_edge_decoration_ccs,
    _exclude_rectangular_edge_clusters,
    _exclude_straight_edged_clusters,
    _merge_fragmented_clusters,
)

W, H = 400, 300
COLORS = [
    [120, 170, 110],
    [180, 160, 90],
    [110, 140, 190],
    [40, 60, 140],
    [200, 40, 40],
    [30, 30, 30],
    [60, 120, 200],
    [125, 175, 112],
    [230, 120, 200],
]


def _shade(image: np.ndarray, on: np.ndarray, rgb: list[int], spread: int) -> None:
    ys, xs = np.nonzero(on)
    if spread == 0:
        image[on] = rgb[::-1]
        return
    for c, v in enumerate(rgb[::-1]):
        image[ys, xs, c] = np.clip(v + spread * (xs - xs.mean()) / W - spread * (ys - ys.mean()) / H, 0, 255)


def _scene(
    paint: Callable[[Callable[[int, Callable[[np.ndarray], object], int], None]], None],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cluster labels (255 off the country), the country mask and the filtered image."""
    labels = np.full((H, W), 255, np.uint8)
    image = np.full((H, W, 3), 235, np.uint8)

    def put(label: int, draw: Callable[[np.ndarray], object], spread: int) -> None:
        shape = np.zeros((H, W), np.uint8)
        draw(shape)
        on = shape > 0
        labels[on] = label
        _shade(image, on, COLORS[label], spread)

    paint(put)
    return labels, (labels < 255).astype(np.uint8), image


def _poly(*pts: tuple[int, int]) -> Callable[[np.ndarray], object]:
    return lambda m: cv2.fillPoly(m, [np.array(pts, np.int32)], 1)


def _furnished(put: Callable[[int, Callable[[np.ndarray], object], int], None]) -> None:
    # Three provinces
    put(0, _poly((90, 60), (200, 40), (210, 150), (150, 170), (80, 140)), 60)
    put(1, _poly((200, 40), (320, 70), (330, 160), (210, 150)), 60)
    put(2, _poly((80, 140), (150, 170), (330, 160), (300, 250), (110, 240)), 60)
    # Furniture: a title box, a compass, a scale bar, a label, a legend swatch
    put(3, lambda m: cv2.rectangle(m, (6, 6), (70, 40), 1, -1), 0)
    put(4, lambda m: cv2.circle(m, (380, 22), 11, 1, -1), 0)
    put(5, lambda m: cv2.rectangle(m, (250, 282), (330, 289), 1, -1), 0)
    put(6, _poly((345, 230), (390, 230), (396, 245), (390, 260), (345, 260)), 0)
    # A swatch painted in province 1's colour, so it shares its cluster
    put(1, lambda m: cv2.rectangle(m, (8, 250), (40, 280), 1, -1), 0)
    # A cape of province 2 that reaches the bottom edge
    put(2, _poly((110, 240), (140, 245), (125, 290), (100, 285)), 60)


def _fragmented(put: Callable[[int, Callable[[np.ndarray], object], int], None]) -> None:
    put(0, _poly((60, 50), (340, 50), (340, 250), (60, 250)), 60)
    # A road through province 0 in a colour close to it, broken into pieces
    for k in range(9):
        put(7, lambda m, k=k: cv2.rectangle(m, (80 + 28 * k, 140), (92 + 28 * k, 144), 1, -1), 0)
    # Text in a far colour, scattered: fragmented but no colour-close neighbour
    for k in range(6):
        put(8, lambda m, k=k: cv2.circle(m, (100 + 40 * k, 90), 3, 1, -1), 0)
    # A real two-part province beside it
    put(2, _poly((340, 50), (395, 60), (390, 150), (340, 150)), 60)
    put(2, _poly((340, 170), (390, 175), (385, 250), (340, 250)), 60)


SCENES = {"a furnished map": _furnished, "a map with a broken road": _fragmented}


def _steps() -> dict[str, Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray]]:
    colors = [list(c) for c in COLORS]
    return {
        "edge decoration CCs": lambda labels, mask, image: _exclude_edge_decoration_ccs(labels, mask),
        "rectangular edge clusters": lambda labels, mask, image: _exclude_rectangular_edge_clusters(
            labels, colors, image, mask
        ),
        "straight-edged clusters": lambda labels, mask, image: _exclude_straight_edged_clusters(
            labels, colors, image, mask
        ),
        "fragmented residue merge": lambda labels, mask, image: _merge_fragmented_clusters(labels, colors, mask),
    }


def _answer(before: np.ndarray, after: np.ndarray) -> tuple[int, str]:
    return int(np.count_nonzero(before != after)), hashlib.sha256(after.tobytes()).hexdigest()


# Recorded from cleanup.py before #1654 split it: (pixels changed, result digest).
EXPECTED: dict[tuple[str, str], tuple[int, str]] = {
    ("a furnished map", "edge decoration CCs"): (
        1023,
        "0549e322010f71ee4f7d7fc52fa7fc6c9ebb077627ae6dde86c669589dd5d5bf",
    ),
    ("a furnished map", "rectangular edge clusters"): (
        4816,
        "28c179790755e594940612f57438e0586f37d6ada7ce924c953319de6b35cecc",
    ),
    ("a furnished map", "straight-edged clusters"): (
        4439,
        "3c50096fabe593aa81ce139d978432f763ccefcd9f2ef7ca2d04af416b4a7741",
    ),
    ("a furnished map", "fragmented residue merge"): (
        0,
        "349fad03b4e5f91106e9b5c17698e6404c6eeefc44f8fcdb78ba817791232008",
    ),
    ("a map with a broken road", "edge decoration CCs"): (
        130,
        "954ac2eb966d3d3b00ab592c43af9b9b7d1490fcacb80fb039c767f8ed2c50a8",
    ),
    ("a map with a broken road", "rectangular edge clusters"): (
        0,
        "0f040009d0ac9807bd76d0beb7e523dde28475b30472d55bbdd0453bf094483c",
    ),
    ("a map with a broken road", "straight-edged clusters"): (
        0,
        "0f040009d0ac9807bd76d0beb7e523dde28475b30472d55bbdd0453bf094483c",
    ),
    ("a map with a broken road", "fragmented residue merge"): (
        585,
        "ecf2d8f49a3ba6b95db17d68e914042492a4067c6a519304665945b3ac32ffff",
    ),
}


@pytest.mark.parametrize("step", list(_steps()))
@pytest.mark.parametrize("scene", list(SCENES))
def test_the_step_answers_as_it_did_before_the_split(scene: str, step: str) -> None:
    labels, mask, image = _scene(SCENES[scene])
    before = labels.copy()
    after = _steps()[step](labels, mask, image)

    assert np.array_equal(labels, before), "the step must not write its input"
    assert _answer(before, after) == EXPECTED[(scene, step)]


@pytest.mark.parametrize("step", list(_steps()))
def test_an_empty_country_is_returned_as_it_is(step: str) -> None:
    labels = np.full((H, W), 255, np.uint8)
    mask = np.zeros((H, W), np.uint8)
    assert _steps()[step](labels, mask, np.zeros((H, W, 3), np.uint8)) is labels
