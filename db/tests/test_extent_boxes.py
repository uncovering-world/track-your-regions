#!/usr/bin/env python3
"""
Unit tests for extent box generation.

Run with: pytest db/tests/test_extent_boxes.py -v
         (from new-gen directory)
"""

import math
import sys
import os

# Add scripts directory to path for imports
_SCRIPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts')
sys.path.insert(0, _SCRIPT_DIR)

import pytest

# Now import from the generator module
from generate_extent_boxes import (
    find_optimal_longitude_shift,
    wrap_longitude,
    compute_extent_box,
    boxes_overlap,
    resolve_overlaps,
    BoxParams,
    ExtentBox,
    km_to_deg,
    deg_to_km,
    KM_PER_DEG_LAT,
)


def apply_shift(lngs, shift):
    """Apply shift the same way compute_extent_box does (selectively)."""
    if shift == 360:
        return [lng + 360 if lng < 0 else lng for lng in lngs]
    elif shift == -360:
        return [lng - 360 if lng > 0 else lng for lng in lngs]
    else:
        return lngs


class TestDatelineHandling:
    """Tests for dateline/antimeridian handling."""

    def test_normal_region_no_shift(self):
        """Normal regions (not crossing dateline) should have shift=0."""
        lngs = [10.0, 15.0, 20.0]
        shift = find_optimal_longitude_shift(lngs)
        assert shift == 0.0

    def test_fiji_crossing_dateline(self):
        """Fiji spans -180 to +180, should produce compact box with shift."""
        # Fiji islands at both sides of dateline
        lngs = [-179.5, -178.0, 179.5, 178.0]
        shift = find_optimal_longitude_shift(lngs)

        # With optimal shift (selective), span should be small (< 10 degrees)
        shifted = apply_shift(lngs, shift)
        span = max(shifted) - min(shifted)
        assert span < 10, f"Span {span} should be < 10 degrees after shift"

    def test_russia_far_east(self):
        """Russia Far East archipelagos should handle dateline correctly."""
        # Kuril Islands span across dateline
        lngs = [145.0, 150.0, 155.0, -175.0, -170.0]
        shift = find_optimal_longitude_shift(lngs)

        shifted = apply_shift(lngs, shift)
        span = max(shifted) - min(shifted)
        # Should be ~50 degrees, not ~320 degrees
        assert span < 100, f"Span {span} should be < 100 degrees"

    def test_kiribati_line_islands(self):
        """Kiribati Line Islands (around -160 to -150) should not need shift."""
        lngs = [-157.0, -155.0, -152.0]
        shift = find_optimal_longitude_shift(lngs)
        assert shift == 0.0

    def test_empty_list(self):
        """Empty longitude list should return 0."""
        assert find_optimal_longitude_shift([]) == 0.0

    def test_single_point(self):
        """Single point should return 0 shift."""
        assert find_optimal_longitude_shift([45.0]) == 0.0


class TestWrapLongitude:
    """Tests for longitude wrapping to [-180, 180]."""

    def test_normal_longitude(self):
        """Normal longitudes should not change."""
        assert wrap_longitude(45.0) == 45.0
        assert wrap_longitude(-90.0) == -90.0
        assert wrap_longitude(0.0) == 0.0

    def test_positive_overflow(self):
        """Longitudes > 180 should wrap to negative."""
        assert wrap_longitude(190.0) == -170.0
        assert wrap_longitude(270.0) == -90.0
        assert wrap_longitude(360.0) == 0.0
        assert wrap_longitude(540.0) == 180.0

    def test_negative_overflow(self):
        """Longitudes < -180 should wrap to positive."""
        assert wrap_longitude(-190.0) == 170.0
        assert wrap_longitude(-270.0) == 90.0
        assert wrap_longitude(-360.0) == 0.0


class TestMinimumSizeEnforcement:
    """Tests for minimum size enforcement."""

    def test_tiny_archipelago_gets_min_size(self):
        """A tiny archipelago should get minimum-sized box."""
        # Single small point
        points = [(0.0, 0.0)]
        params = BoxParams(pad_km=30, min_w_km=250, min_h_km=250, max_aspect=2.5)

        center_lng, center_lat, width_km, height_km, _ = compute_extent_box(points, params)

        assert width_km >= 250, f"Width {width_km} should be >= 250 km"
        assert height_km >= 250, f"Height {height_km} should be >= 250 km"

    def test_small_cluster_gets_min_size(self):
        """A small cluster should get minimum-sized box."""
        # Small cluster of points
        points = [(0.0, 0.0), (0.01, 0.01), (0.02, 0.0)]
        params = BoxParams(pad_km=30, min_w_km=250, min_h_km=250, max_aspect=2.5)

        center_lng, center_lat, width_km, height_km, _ = compute_extent_box(points, params)

        assert width_km >= 250
        assert height_km >= 250

    def test_large_cluster_exceeds_min_size(self):
        """A large cluster should exceed minimum size."""
        # Points spanning ~500 km at equator (about 4.5 degrees)
        points = [(0.0, 0.0), (4.5, 0.0)]  # ~500 km apart at equator
        params = BoxParams(pad_km=30, min_w_km=250, min_h_km=250, max_aspect=2.5)

        center_lng, center_lat, width_km, height_km, _ = compute_extent_box(points, params)

        # Should be at least 500 + 2*30 = 560 km wide
        assert width_km >= 500, f"Width {width_km} should be >= 500 km"


class TestAspectRatioClamping:
    """Tests for aspect ratio clamping."""

    def test_narrow_strip_gets_expanded(self):
        """A narrow strip should be expanded to meet max aspect ratio."""
        # Long narrow strip (10 degrees lng x 0.5 degrees lat at equator)
        # That's about 1110 km x 55 km = aspect ratio ~20
        points = [(0.0, 0.0), (10.0, 0.0), (5.0, 0.5)]
        params = BoxParams(pad_km=30, min_w_km=100, min_h_km=100, max_aspect=2.5)

        center_lng, center_lat, width_km, height_km, _ = compute_extent_box(points, params)

        # Check aspect ratio
        aspect = max(width_km / height_km, height_km / width_km)
        assert aspect <= 2.5 + 0.01, f"Aspect {aspect} should be <= 2.5"

    def test_tall_strip_gets_expanded(self):
        """A tall strip should be expanded horizontally."""
        # Tall narrow strip (0.5 degrees lng x 10 degrees lat)
        points = [(0.0, 0.0), (0.5, 10.0), (0.25, 5.0)]
        params = BoxParams(pad_km=30, min_w_km=100, min_h_km=100, max_aspect=2.5)

        center_lng, center_lat, width_km, height_km, _ = compute_extent_box(points, params)

        aspect = max(width_km / height_km, height_km / width_km)
        assert aspect <= 2.5 + 0.01, f"Aspect {aspect} should be <= 2.5"

    def test_square_cluster_no_expansion(self):
        """A roughly square cluster should not need expansion."""
        # Square cluster
        points = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
        params = BoxParams(pad_km=30, min_w_km=100, min_h_km=100, max_aspect=2.5)

        center_lng, center_lat, width_km, height_km, _ = compute_extent_box(points, params)

        aspect = max(width_km / height_km, height_km / width_km)
        assert aspect <= 2.5, f"Aspect {aspect} should be <= 2.5"


class TestOverlapResolution:
    """Tests for overlap resolution algorithm."""

    def test_no_overlap_unchanged(self):
        """Non-overlapping boxes should remain unchanged."""
        box1 = ExtentBox(
            region_id=1, region_name="A", parent_region_id=None,
            center_lng=0.0, center_lat=0.0, width_km=200, height_km=200
        )
        box2 = ExtentBox(
            region_id=2, region_name="B", parent_region_id=None,
            center_lng=10.0, center_lat=0.0, width_km=200, height_km=200  # Far apart
        )

        original_c1 = (box1.center_lng, box1.center_lat)
        original_c2 = (box2.center_lng, box2.center_lat)

        params = BoxParams()
        boxes = resolve_overlaps([box1, box2], params)

        # Should be unchanged (or very close)
        assert abs(boxes[0].center_lng - original_c1[0]) < 0.01
        assert abs(boxes[1].center_lng - original_c2[0]) < 0.01

    def test_overlapping_boxes_separated(self):
        """Overlapping boxes should be pushed apart."""
        # Two boxes with significant overlap
        box1 = ExtentBox(
            region_id=1, region_name="A", parent_region_id=None,
            center_lng=0.0, center_lat=0.0, width_km=300, height_km=300
        )
        box2 = ExtentBox(
            region_id=2, region_name="B", parent_region_id=None,
            center_lng=1.0, center_lat=0.0, width_km=300, height_km=300  # Overlapping
        )

        params = BoxParams(max_iter=200, max_step_km=20)
        boxes = resolve_overlaps([box1, box2], params)

        # After resolution, boxes should not overlap
        overlap = boxes_overlap(boxes[0], boxes[1])
        assert not overlap, "Boxes should not overlap after resolution"

    def test_three_boxes_cluster(self):
        """Three overlapping boxes in a cluster should all be separated."""
        boxes = [
            ExtentBox(region_id=1, region_name="A", parent_region_id=None,
                     center_lng=0.0, center_lat=0.0, width_km=300, height_km=300),
            ExtentBox(region_id=2, region_name="B", parent_region_id=None,
                     center_lng=1.0, center_lat=0.5, width_km=300, height_km=300),
            ExtentBox(region_id=3, region_name="C", parent_region_id=None,
                     center_lng=0.5, center_lat=1.0, width_km=300, height_km=300),
        ]

        params = BoxParams(max_iter=200, max_step_km=20)
        resolved = resolve_overlaps(boxes, params)

        # Check all pairs
        for i, b1 in enumerate(resolved):
            for b2 in resolved[i+1:]:
                assert not boxes_overlap(b1, b2), f"Boxes {b1.region_id} and {b2.region_id} should not overlap"

    def test_deterministic_output(self):
        """Same input should produce same output."""
        def create_boxes():
            return [
                ExtentBox(region_id=1, region_name="A", parent_region_id=None,
                         center_lng=0.0, center_lat=0.0, width_km=300, height_km=300),
                ExtentBox(region_id=2, region_name="B", parent_region_id=None,
                         center_lng=1.0, center_lat=0.5, width_km=300, height_km=300),
            ]

        params = BoxParams(max_iter=200, max_step_km=20)

        # Run twice
        result1 = resolve_overlaps(create_boxes(), params)
        result2 = resolve_overlaps(create_boxes(), params)

        # Results should be identical
        for b1, b2 in zip(result1, result2):
            assert abs(b1.center_lng - b2.center_lng) < 0.0001
            assert abs(b1.center_lat - b2.center_lat) < 0.0001


class TestSyntheticDataset:
    """Tests using the synthetic dataset from the plan."""

    def test_three_clusters(self):
        """
        Test the synthetic dataset produces 3 non-overlapping boxes.

        islands = [
          {"id":"A1","lon": 0.0,"lat":0.0},
          {"id":"A2","lon": 0.8,"lat":0.5},
          {"id":"A3","lon": 0.3,"lat":1.1},
          {"id":"B1","lon": 6.8,"lat":0.1},
          {"id":"B2","lon": 7.6,"lat":0.9},
          {"id":"C1","lon":12.1,"lat":0.2},
          {"id":"C2","lon":12.7,"lat":1.0},
          {"id":"C3","lon":13.2,"lat":1.8},
        ]
        """
        # Cluster A points
        cluster_a = [(0.0, 0.0), (0.8, 0.5), (0.3, 1.1)]
        # Cluster B points
        cluster_b = [(6.8, 0.1), (7.6, 0.9)]
        # Cluster C points
        cluster_c = [(12.1, 0.2), (12.7, 1.0), (13.2, 1.8)]

        params = BoxParams(pad_km=30, min_w_km=250, min_h_km=250, max_aspect=2.5)

        # Generate boxes for each cluster
        box_a_data = compute_extent_box(cluster_a, params)
        box_b_data = compute_extent_box(cluster_b, params)
        box_c_data = compute_extent_box(cluster_c, params)

        boxes = [
            ExtentBox(region_id=1, region_name="A", parent_region_id=None,
                     center_lng=box_a_data[0], center_lat=box_a_data[1],
                     width_km=box_a_data[2], height_km=box_a_data[3],
                     lng_shift=box_a_data[4]),
            ExtentBox(region_id=2, region_name="B", parent_region_id=None,
                     center_lng=box_b_data[0], center_lat=box_b_data[1],
                     width_km=box_b_data[2], height_km=box_b_data[3],
                     lng_shift=box_b_data[4]),
            ExtentBox(region_id=3, region_name="C", parent_region_id=None,
                     center_lng=box_c_data[0], center_lat=box_c_data[1],
                     width_km=box_c_data[2], height_km=box_c_data[3],
                     lng_shift=box_c_data[4]),
        ]

        # Cluster B should get min-sized box (only 2 close points)
        assert boxes[1].width_km >= 250, "Cluster B should have min width"
        assert boxes[1].height_km >= 250, "Cluster B should have min height"

        # Resolve overlaps
        resolved = resolve_overlaps(boxes, params)

        # Verify no overlaps
        for i, b1 in enumerate(resolved):
            for b2 in resolved[i+1:]:
                assert not boxes_overlap(b1, b2), f"Boxes {b1.region_name} and {b2.region_name} should not overlap"


class TestCoordinateConversion:
    """Tests for coordinate conversion utilities."""

    def test_deg_to_km_equator(self):
        """At equator, 1 degree lng = 1 degree lat in km."""
        width, height = deg_to_km(1.0, 1.0, 0.0)
        assert abs(width - 111) < 1  # ~111 km per degree
        assert abs(height - 111) < 1

    def test_deg_to_km_high_latitude(self):
        """At high latitude, 1 degree lng < 1 degree lat in km."""
        width, height = deg_to_km(1.0, 1.0, 60.0)
        assert width < height  # lng degrees are shorter at high latitudes
        assert abs(width - 55.5) < 2  # ~55.5 km at 60 degrees (111 * cos(60))
        assert abs(height - 111) < 1

    def test_km_to_deg_roundtrip(self):
        """km_to_deg should be inverse of deg_to_km."""
        original_lng, original_lat = 2.0, 3.0
        center_lat = 45.0

        width_km, height_km = deg_to_km(original_lng, original_lat, center_lat)
        lng_span, lat_span = km_to_deg(width_km, height_km, center_lat)

        assert abs(lng_span - original_lng) < 0.01
        assert abs(lat_span - original_lat) < 0.01


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
