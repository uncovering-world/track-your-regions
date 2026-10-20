"""The preprocessing phase, held to the answers it gave before it was split (#1654).

Two drawn maps go through the whole first phase: a country of three regions on a sea, with a
road, a river, a label in dark ink, a title box in the sea's colour near an edge and a compass
of dots; and the same country cut off by an inset rule with an island below it. The OCR step is
stood in for by "no text found", since EasyOCR is a model download and its answer is its own
spec's, and SAM skips itself without its model file. Each case holds the phase's answer as it
was recorded before the split: every mask by its pixels' digest, the country's size, the water
components and the progress steps.
"""

import base64
import hashlib

import cv2
import numpy as np
import pytest

from app.cv import preprocess, text_detection

W, H = 400, 300
SEA = (205, 170, 130)  # BGR, a Wikivoyage blue


def _country(inset: bool) -> np.ndarray:
    image = np.full((H, W, 3), SEA, np.uint8)
    cv2.fillPoly(image, [np.array([[70, 50], [200, 40], [210, 160], [80, 180]], np.int32)], (110, 190, 120))
    cv2.fillPoly(image, [np.array([[200, 40], [330, 60], [320, 170], [210, 160]], np.int32)], (90, 160, 200))
    cv2.fillPoly(
        image, [np.array([[80, 180], [210, 160], [320, 170], [290, 220], [100, 225]], np.int32)], (160, 120, 190)
    )
    cv2.polylines(image, [np.array([[90, 120], [180, 110], [300, 130]], np.int32)], False, (40, 200, 240), 3)
    cv2.polylines(image, [np.array([[150, 60], [160, 140], [170, 210]], np.int32)], False, (220, 120, 60), 2)
    cv2.putText(image, "REGIO", (220, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1, cv2.LINE_AA)
    cv2.rectangle(image, (8, 8), (90, 34), SEA, -1)
    cv2.rectangle(image, (8, 8), (90, 34), (60, 60, 60), 1)
    for dx, dy in [(0, 0), (10, 0), (-10, 0), (0, 10), (0, -10)]:
        cv2.circle(image, (370 + dx, 30 + dy), 3, (30, 30, 30), -1)
    # A lagoon in the sea's colour inside a shore near the edge: the inland-water search finds it,
    # and an operator, when there is one, is asked about it
    star = np.array(
        [
            [350 + int(r * np.cos(a)), 255 + int(r * np.sin(a))]
            for a, r in zip(np.linspace(0, 2 * np.pi, 14, endpoint=False), [38, 16] * 7, strict=True)
        ],
        np.int32,
    )
    cv2.fillPoly(image, [star], (160, 120, 190))
    cv2.fillPoly(image, [((star - [350, 255]) * 0.8 + [350, 255]).astype(np.int32)], SEA)
    if inset:
        cv2.line(image, (0, 245), (W - 1, 245), (40, 40, 40), 2)
        cv2.ellipse(image, (60, 272), (30, 14), 0, 0, 360, (110, 190, 120), -1)
    return image


def _digest(data_url: str) -> str:
    png = base64.b64decode(data_url.split(",", 1)[1])
    pixels = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_UNCHANGED)
    return hashlib.sha256(repr(pixels.shape).encode() + pixels.tobytes()).hexdigest()


def _answer(result: dict) -> dict:
    return {
        "filteredImage": _digest(result["filteredImage"]),
        "waterMask": _digest(result["waterMask"]),
        "countryMask": _digest(result["countryMask"]),
        "knownNoiseMask": _digest(result["knownNoiseMask"]),
        "countrySize": result["countrySize"],
        "waterComponents": result["waterComponents"],
        "debugImages": [(img["label"], _digest(img["dataUrl"])) for img in result["debugImages"]],
    }


CASES = {
    "a country on a sea with its map furniture": (False, False),
    "the same country above an inset rule": (True, False),
    "the first map, with an operator asked about its water": (False, True),
}


def _no_answer(kind: str, data: dict, timeout: float = 600) -> None:
    """An operator who does not answer the water review: the detected water stands."""


# Recorded from run_phase1 before #1654 split it.
EXPECTED: dict[str, dict] = {
    "a country on a sea with its map furniture": {
        "filteredImage": "246960a7609739d2cfe93bfe49dda4d7c6c76325990a42ba4311aa1e139769d6",
        "waterMask": "f89be822cc586c01ce125117cf625921b339d1b62401eebf4ddcd9751af0ada4",
        "countryMask": "8b6016f28f9422c41abe317ec416098a117e18d6c59f7d71403edb3503085804",
        "knownNoiseMask": "2e36f507c9f0365067aaf2b6316e4905611b53f6de635886505e4b27eae822bb",
        "countrySize": 43098,
        "waterComponents": [{"id": 1, "pct": 2.9}],
        "debugImages": [
            ("Mean-shift filtered (Python)", "442e8818d9ec25d75a95cbc9ed36cef783257c473e85593d93ae338d5907f6db"),
            (
                "Background (gray) + Water (blue) + Known noise (red)",
                "9cef206b2cfd1edc2da8d5aafa0a86d470dd71fa3cb2bf56bb840ff6bf0abf5d",
            ),
        ],
        "steps": [
            "OCR text detection and removal...",
            "Inpainting colored roads...",
            "Removing colored lines...",
            "Saturated text residue cleanup...",
            "Dark text residue cleanup...",
            "Mean-shift filtering pass 1/2 (sp=10, sr=20)...",
            "Mean-shift filtering pass 2/2 (sp=20, sr=30)...",
            "Top-hat text/symbol removal...",
            "Outlier pixel cleanup...",
            "Bilateral filter (edge-preserving smoothing)...",
            "Late dark blob detection...",
            "Inset box detection...",
            "Two-stage background detection...",
            "Hough circle detection...",
            "Isolated CC group detection...",
            "SAM decoration segmentation...",
            "Edge decoration exclusion...",
            "Gray edge region exclusion...",
            "Water detection (edge seeding + inland lakes)...",
        ],
    },
    "the same country above an inset rule": {
        "filteredImage": "11167dbd90db664c000f47ab9a41a6871e865573710608708890e13266df30d1",
        "waterMask": "5e6d7efd686ef57c3144889b10b4c4ca2c0c24489a97e1accd483f410ece0c49",
        "countryMask": "feac5aecc21965edda3e8196284e40ebd0cd9b181f2fa141fdf1fb5b66ce183f",
        "knownNoiseMask": "f72c422c43a6954564dac148a64ffec0cdf056c9a33778eafaa41d89074f1741",
        "countrySize": 42743,
        "waterComponents": [],
        "debugImages": [
            ("Mean-shift filtered (Python)", "11b6c3c35597e4d469c1eaeb3a7ed23d8e8374b113fc905140a1e6d71c29ffe5"),
            (
                "Background (gray) + Water (blue) + Known noise (red)",
                "3b0d458031874dd3c4a596f630f30b9b9f4e104ac9b3b49c363925b1df597561",
            ),
        ],
        "steps": [
            "OCR text detection and removal...",
            "Inpainting colored roads...",
            "Removing colored lines...",
            "Saturated text residue cleanup...",
            "Dark text residue cleanup...",
            "Mean-shift filtering pass 1/2 (sp=10, sr=20)...",
            "Mean-shift filtering pass 2/2 (sp=20, sr=30)...",
            "Top-hat text/symbol removal...",
            "Outlier pixel cleanup...",
            "Bilateral filter (edge-preserving smoothing)...",
            "Late dark blob detection...",
            "Inset box detection...",
            "Two-stage background detection...",
            "Hough circle detection...",
            "Isolated CC group detection...",
            "SAM decoration segmentation...",
            "Edge decoration exclusion...",
            "Gray edge region exclusion...",
            "Water detection (edge seeding + inland lakes)...",
        ],
    },
    "the first map, with an operator asked about its water": {
        "filteredImage": "246960a7609739d2cfe93bfe49dda4d7c6c76325990a42ba4311aa1e139769d6",
        "waterMask": "f89be822cc586c01ce125117cf625921b339d1b62401eebf4ddcd9751af0ada4",
        "countryMask": "8b6016f28f9422c41abe317ec416098a117e18d6c59f7d71403edb3503085804",
        "knownNoiseMask": "2e36f507c9f0365067aaf2b6316e4905611b53f6de635886505e4b27eae822bb",
        "countrySize": 43098,
        "waterComponents": [{"id": 1, "pct": 2.9}],
        "debugImages": [
            ("Mean-shift filtered (Python)", "442e8818d9ec25d75a95cbc9ed36cef783257c473e85593d93ae338d5907f6db"),
            (
                "Background (gray) + Water (blue) + Known noise (red)",
                "9cef206b2cfd1edc2da8d5aafa0a86d470dd71fa3cb2bf56bb840ff6bf0abf5d",
            ),
        ],
        "steps": [
            "OCR text detection and removal...",
            "Inpainting colored roads...",
            "Removing colored lines...",
            "Saturated text residue cleanup...",
            "Dark text residue cleanup...",
            "Mean-shift filtering pass 1/2 (sp=10, sr=20)...",
            "Mean-shift filtering pass 2/2 (sp=20, sr=30)...",
            "Top-hat text/symbol removal...",
            "Outlier pixel cleanup...",
            "Bilateral filter (edge-preserving smoothing)...",
            "Late dark blob detection...",
            "Inset box detection...",
            "Two-stage background detection...",
            "Hough circle detection...",
            "Isolated CC group detection...",
            "SAM decoration segmentation...",
            "Edge decoration exclusion...",
            "Gray edge region exclusion...",
            "Water detection (edge seeding + inland lakes)...",
            "Water review — 1 component(s), 2.9% of country",
        ],
    },
}


@pytest.fixture(autouse=True)
def _no_ocr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(text_detection, "remove_text_from_image", lambda img: (img, np.zeros(img.shape[:2], np.uint8)))


@pytest.mark.parametrize("case", list(CASES))
def test_the_phase_answers_as_it_did_before_the_split(case: str) -> None:
    inset, review = CASES[case]
    steps: list[str] = []
    result = preprocess.run_phase1(
        _country(inset), W, H, W * 2, H * 2, on_progress=steps.append, on_review=_no_answer if review else None
    )
    got = {**_answer(result), "steps": steps}

    assert got == EXPECTED[case]
