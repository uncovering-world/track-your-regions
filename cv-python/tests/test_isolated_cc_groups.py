"""The isolated CC group exclusion, held to the answers it gave before it was split (#1654).

A compass rose, a legend or a scale bar is drawn as several small pieces that sit close
together away from the land; an archipelago's islands are spread further apart. Each case
draws a country mask with such pieces and holds which of them the exclusion kept, recorded
from the function as it stood before the split.
"""

from collections.abc import Callable

import cv2
import numpy as np
import pytest

from app.cv.preprocess import _exclude_isolated_cc_groups

W, H = 400, 300


def _dots(centres: list[tuple[int, int]], radius: int = 4) -> Callable[[np.ndarray], None]:
    def draw(m: np.ndarray) -> None:
        for c in centres:
            cv2.circle(m, c, radius, 1, -1)

    return draw


def _mainland(m: np.ndarray) -> None:
    cv2.fillPoly(m, [np.array([[60, 60], [300, 50], [320, 200], [80, 230]], np.int32)], 1)


SCENES: dict[str, dict[str, Callable[[np.ndarray], object]]] = {
    "a compass of five points beside a mainland": {
        "mainland": _mainland,
        "the compass": _dots([(360, 250), (372, 250), (348, 250), (360, 238), (360, 262)]),
    },
    "a legend of three swatches and an archipelago": {
        "mainland": _mainland,
        "the legend": _dots([(20, 270), (40, 270), (60, 270)], radius=5),
        "the archipelago": _dots([(350, 40), (380, 110), (345, 170)], radius=6),
    },
    "two pieces only, under the group size": {
        "mainland": _mainland,
        "a pair of dots": _dots([(360, 260), (375, 262)]),
    },
    "a group too large to be a decoration": {
        "mainland": lambda m: cv2.rectangle(m, (20, 20), (220, 170), 1, -1),
        "three large islands close together": _dots([(300, 250), (345, 250), (322, 210)], radius=20),
    },
    "a piece that touches the mainland": {
        "mainland": _mainland,
        "dots a few pixels off the coast": _dots([(316, 120), (318, 135), (314, 105)], radius=3),
    },
}


def _mask(shapes: dict[str, Callable[[np.ndarray], object]]) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    mask = np.zeros((H, W), np.uint8)
    drawn = {}
    for name, draw in shapes.items():
        layer = np.zeros((H, W), np.uint8)
        draw(layer)
        drawn[name] = layer > 0
        mask |= layer
    return mask, drawn


# Recorded from _exclude_isolated_cc_groups before #1654 split it: the shapes kept.
EXPECTED_KEPT: dict[str, set[str]] = {
    "a compass of five points beside a mainland": {"mainland"},
    "a legend of three swatches and an archipelago": {"mainland", "the archipelago"},
    "two pieces only, under the group size": {"a pair of dots", "mainland"},
    "a group too large to be a decoration": {"mainland", "three large islands close together"},
    "a piece that touches the mainland": {"dots a few pixels off the coast", "mainland"},
}


@pytest.mark.parametrize("scene", list(SCENES))
def test_the_exclusion_keeps_what_it_kept_before_the_split(scene: str) -> None:
    mask, drawn = _mask(SCENES[scene])
    result = _exclude_isolated_cc_groups(mask, np.zeros((H, W, 3), np.uint8))

    kept = {name for name, on in drawn.items() if np.any(result[on])}
    assert kept == EXPECTED_KEPT[scene]
    for name, on in drawn.items():
        assert np.all(result[on] == (1 if name in kept else 0)), name


def test_an_empty_or_single_mask_is_returned_as_it_is() -> None:
    empty = np.zeros((H, W), np.uint8)
    assert _exclude_isolated_cc_groups(empty, np.zeros((H, W, 3), np.uint8)) is empty
    single, _ = _mask({"mainland": _mainland})
    assert _exclude_isolated_cc_groups(single, np.zeros((H, W, 3), np.uint8)) is single
