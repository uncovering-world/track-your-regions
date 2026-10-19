"""Inset detection, held to the answers it gave before it was split (#1654).

A map of the United States puts Alaska and Hawaii in boxes cut off by straight
lines across the image. Each case draws a map with such dividing lines, or with
lines that only look like them (a wavy coast, a dashed road, a short rule), and
holds what the detection returned before the split: None, or the inset mask by
its masked pixel count and digest.
"""

import hashlib
from collections.abc import Callable

import cv2
import numpy as np
import pytest

from app.cv.preprocess import _detect_inset_mask

W, H = 400, 300


def _map(draw: Callable[[np.ndarray], object]) -> np.ndarray:
    """A light map with some land on it, and whatever draw adds."""
    image = np.full((H, W, 3), 235, np.uint8)
    cv2.ellipse(image, (200, 110), (150, 70), 0, 0, 360, (120, 170, 110), -1)
    cv2.circle(image, (60, 250), 20, (120, 170, 110), -1)
    cv2.circle(image, (330, 250), 12, (120, 170, 110), -1)
    draw(image)
    return image


def _rule(image: np.ndarray, p0: tuple[int, int], p1: tuple[int, int]) -> None:
    cv2.line(image, p0, p1, (40, 40, 40), 2)


def _dashed(image: np.ndarray, y: int) -> None:
    for x in range(0, W, 30):
        cv2.line(image, (x, y), (x + 12, y), (40, 40, 40), 2)


def _wavy(image: np.ndarray, y: int) -> None:
    xs = np.arange(0, W)
    pts = np.stack([xs, y + (8 * np.sin(xs / 9.0)).astype(int)], axis=1).astype(np.int32)
    cv2.polylines(image, [pts], False, (40, 40, 40), 2)


CASES: dict[str, Callable[[np.ndarray], object]] = {
    "a map with no dividing line": lambda img: None,
    "a rule across the map above two insets": lambda img: _rule(img, (0, 200), (W - 1, 200)),
    "a rule across and one down, four sections": lambda img: (
        _rule(img, (0, 200), (W - 1, 200)),
        _rule(img, (130, 0), (130, H - 1)),
    ),
    "two rules crossing in the middle: no section is the main map": lambda img: (
        _rule(img, (0, 150), (W - 1, 150)),
        _rule(img, (200, 0), (200, H - 1)),
    ),
    "a rule near the middle: the other half is as large as the main map": lambda img: _rule(
        img, (0, 140), (W - 1, 140)
    ),
    "a dashed road across the map": lambda img: _dashed(img, 200),
    "a wavy coast across the map": lambda img: _wavy(img, 200),
    "a rule across half the map": lambda img: _rule(img, (0, 200), (W // 2, 200)),
}


def _answer(mask: np.ndarray | None) -> tuple[int, str] | None:
    if mask is None:
        return None
    return int(np.count_nonzero(mask)), hashlib.sha256(repr(mask.shape).encode() + mask.tobytes()).hexdigest()


# Recorded from _detect_inset_mask before #1654 split it.
EXPECTED: dict[str, tuple[int, str] | None] = {
    "a map with no dividing line": None,
    "a rule across the map above two insets": (
        40400,
        "337d2b88ea5628a796eb12c8c837d65769a2a123a026029b84cfb46059600340",
    ),
    "a rule across and one down, four sections": (
        66071,
        "34ac1798760817c020a0476430fc8931b85d7efd297b0efde04f59fab0be1a20",
    ),
    "two rules crossing in the middle: no section is the main map": None,
    "a rule near the middle: the other half is as large as the main map": None,
    "a dashed road across the map": None,
    "a wavy coast across the map": None,
    "a rule across half the map": None,
}


@pytest.mark.parametrize("case", list(CASES))
def test_the_detection_answers_as_it_did_before_the_split(case: str) -> None:
    assert _answer(_detect_inset_mask(_map(CASES[case]))) == EXPECTED[case]
