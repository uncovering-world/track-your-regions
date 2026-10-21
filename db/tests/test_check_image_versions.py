"""The build-time check that the loader image carries what db/requirements.txt pins (#1782)."""

import pytest

from check_image_versions import mismatches, pins


def test_reads_the_pins_and_skips_comments():
    assert pins("# header\nGDAL==3.13.3\n\nnumpy==2.3.5  # from the base\n") == {"GDAL": "3.13.3", "numpy": "2.3.5"}


def test_refuses_a_line_that_is_not_pinned():
    with pytest.raises(ValueError, match="not pinned"):
        pins("shapely>=2.0\n")


def test_names_each_pin_the_image_does_not_match():
    pinned = {"GDAL": "3.13.3", "psycopg2": "2.9.11", "shapely": "2.1.2"}
    installed = {"GDAL": "3.13.3", "psycopg2": "2.9.12", "shapely": None}
    assert mismatches(pinned, installed) == [
        "psycopg2: pinned 2.9.11, installed 2.9.12",
        "shapely: pinned 2.1.2, installed nothing",
    ]
    assert mismatches(pinned, {**installed, "psycopg2": "2.9.11", "shapely": "2.1.2"}) == []
