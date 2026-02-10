#!/usr/bin/env python3
"""
Generate extent boxes for archipelago regions.

Replaces Voronoi-based display geometry with clean axis-aligned rectangles.
Handles dateline wrapping, minimum sizes, aspect ratio clamping, and overlap resolution.

Usage:
    python generate-extent-boxes.py --world-view-id=1
    python generate-extent-boxes.py --region-id=42
    python generate-extent-boxes.py --all
"""

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

import psycopg2
from psycopg2.extras import RealDictCursor

# Optional: use shapely for geometry operations if available
try:
    from shapely.geometry import box, Polygon, MultiPolygon, Point
    from shapely.ops import unary_union
    from shapely import wkb
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False
    print("Warning: shapely not installed. Using basic geometry operations.")


# =============================================================================
# Configuration
# =============================================================================

@dataclass
class BoxParams:
    """Parameters for extent box generation."""
    pad_km: float = 30.0           # Padding around island group
    min_w_km: float = 250.0        # Minimum box width
    min_h_km: float = 250.0        # Minimum box height
    max_aspect: float = 2.5        # Maximum aspect ratio
    max_iter: int = 200            # Overlap resolution iterations
    max_step_km: float = 20.0      # Max push distance per iteration
    algo_version: str = "boxes_v1"

    def to_dict(self) -> dict:
        return {
            'pad_km': self.pad_km,
            'min_w_km': self.min_w_km,
            'min_h_km': self.min_h_km,
            'max_aspect': self.max_aspect,
            'algo_version': self.algo_version,
        }


@dataclass
class ExtentBox:
    """Represents a computed extent box."""
    region_id: int
    region_name: str
    parent_region_id: Optional[int]
    center_lng: float
    center_lat: float
    width_km: float
    height_km: float
    lng_shift: float = 0.0  # Dateline shift applied
    original_center_lng: float = 0.0  # Before overlap resolution
    original_center_lat: float = 0.0


# =============================================================================
# Dateline Handling
# =============================================================================

def find_optimal_longitude_shift(longitudes: List[float]) -> float:
    """
    Find the longitude shift that minimizes span for dateline-crossing geometries.

    For geometries like Fiji (islands at both -180 and +180):
    - Without shift: span ~360 degrees (globe-spanning)
    - With selective normalization: span ~3 degrees

    The algorithm normalizes longitudes to a continuous range by shifting
    values that are on the "wrong side" of the dateline.

    Args:
        longitudes: List of longitude values

    Returns:
        Shift value to apply: 0 (no shift needed), 360 (shift negative values up),
        or -360 (shift positive values down)
    """
    if not longitudes or len(longitudes) < 2:
        return 0.0

    min_lng = min(longitudes)
    max_lng = max(longitudes)
    original_span = max_lng - min_lng

    # If span is small, no shift needed
    if original_span < 180:
        return 0.0

    # Check if this looks like a dateline crossing:
    # Large span with values on both sides of the prime meridian
    has_negative = any(lng < -90 for lng in longitudes)
    has_positive = any(lng > 90 for lng in longitudes)

    if not (has_negative and has_positive):
        return 0.0

    # Try normalizing by shifting negative values to positive range (add 360)
    normalized_up = [lng + 360 if lng < 0 else lng for lng in longitudes]
    span_up = max(normalized_up) - min(normalized_up)

    # Try normalizing by shifting positive values to negative range (subtract 360)
    normalized_down = [lng - 360 if lng > 0 else lng for lng in longitudes]
    span_down = max(normalized_down) - min(normalized_down)

    # Choose the best normalization
    if span_up < original_span and span_up <= span_down:
        # Shifting negative values up is best
        # Return 360 as a marker that negative values should be shifted
        return 360.0
    elif span_down < original_span:
        # Shifting positive values down is best
        return -360.0

    return 0.0


def wrap_longitude(lng: float) -> float:
    """Wrap longitude to [-180, 180] range."""
    while lng > 180:
        lng -= 360
    while lng < -180:
        lng += 360
    return lng


# =============================================================================
# Coordinate Conversion
# =============================================================================

# Approximate conversion factors
KM_PER_DEG_LAT = 111.0  # km per degree latitude


def km_per_deg_lng(lat: float) -> float:
    """Get km per degree longitude at a given latitude."""
    return KM_PER_DEG_LAT * math.cos(math.radians(lat))


def deg_to_km(lng_span: float, lat_span: float, center_lat: float) -> Tuple[float, float]:
    """Convert degree spans to km at a given latitude."""
    width_km = lng_span * km_per_deg_lng(center_lat)
    height_km = lat_span * KM_PER_DEG_LAT
    return width_km, height_km


def km_to_deg(width_km: float, height_km: float, center_lat: float) -> Tuple[float, float]:
    """Convert km spans to degrees at a given latitude."""
    lng_span = width_km / max(km_per_deg_lng(center_lat), 0.001)
    lat_span = height_km / KM_PER_DEG_LAT
    return lng_span, lat_span


# =============================================================================
# Box Generation
# =============================================================================

def extract_representative_points(geom_wkb: bytes) -> List[Tuple[float, float]]:
    """
    Extract representative points from geometry.

    For MultiPolygon, returns one point per polygon (centroid or point on surface).
    """
    if not HAS_SHAPELY:
        raise RuntimeError("shapely required for geometry operations")

    geom = wkb.loads(geom_wkb)

    points = []
    if geom.geom_type == 'MultiPolygon':
        for poly in geom.geoms:
            pt = poly.representative_point()
            points.append((pt.x, pt.y))
    elif geom.geom_type == 'Polygon':
        pt = geom.representative_point()
        points.append((pt.x, pt.y))
    elif geom.geom_type == 'Point':
        points.append((geom.x, geom.y))
    elif geom.geom_type in ('MultiPoint', 'GeometryCollection'):
        for g in geom.geoms:
            if hasattr(g, 'x'):
                points.append((g.x, g.y))
            else:
                pt = g.representative_point()
                points.append((pt.x, pt.y))

    return points


def compute_extent_box(
    points: List[Tuple[float, float]],
    params: BoxParams
) -> Tuple[float, float, float, float, float]:
    """
    Compute extent box for a set of points.

    Returns:
        (center_lng, center_lat, width_km, height_km, lng_shift)
    """
    if not points:
        return (0, 0, params.min_w_km, params.min_h_km, 0)

    # Extract longitudes and latitudes
    lngs = [p[0] for p in points]
    lats = [p[1] for p in points]

    # Find optimal longitude shift for dateline handling
    # Returns 360 (shift negative up), -360 (shift positive down), or 0 (no shift)
    lng_shift = find_optimal_longitude_shift(lngs)

    # Apply shift selectively based on the shift value
    if lng_shift == 360:
        # Shift negative longitudes to positive range
        shifted_lngs = [lng + 360 if lng < 0 else lng for lng in lngs]
    elif lng_shift == -360:
        # Shift positive longitudes to negative range
        shifted_lngs = [lng - 360 if lng > 0 else lng for lng in lngs]
    else:
        shifted_lngs = lngs

    # Compute bounding box
    min_lng = min(shifted_lngs)
    max_lng = max(shifted_lngs)
    min_lat = min(lats)
    max_lat = max(lats)

    # Center coordinates (in shifted space)
    center_lng = (min_lng + max_lng) / 2
    center_lat = (min_lat + max_lat) / 2

    # Convert to km
    lng_span = max_lng - min_lng
    lat_span = max_lat - min_lat
    width_km, height_km = deg_to_km(lng_span, lat_span, center_lat)

    # Apply padding
    width_km += 2 * params.pad_km
    height_km += 2 * params.pad_km

    # Enforce minimum size
    width_km = max(width_km, params.min_w_km)
    height_km = max(height_km, params.min_h_km)

    # Enforce max aspect ratio
    aspect = max(width_km / height_km, height_km / width_km) if min(width_km, height_km) > 0 else 1
    if aspect > params.max_aspect:
        if width_km > height_km:
            # Expand height
            height_km = width_km / params.max_aspect
        else:
            # Expand width
            width_km = height_km / params.max_aspect

    return (center_lng, center_lat, width_km, height_km, lng_shift)


# =============================================================================
# Overlap Resolution
# =============================================================================

def boxes_overlap(box1: ExtentBox, box2: ExtentBox) -> bool:
    """Check if two boxes overlap (not just touch)."""
    # Convert to half-widths in degrees
    hw1_lng, hh1_lat = km_to_deg(box1.width_km / 2, box1.height_km / 2, box1.center_lat)
    hw2_lng, hh2_lat = km_to_deg(box2.width_km / 2, box2.height_km / 2, box2.center_lat)

    # Apply same longitude shift if comparing boxes
    c1_lng = box1.center_lng
    c2_lng = box2.center_lng

    # Check axis-aligned overlap
    x_overlap = abs(c1_lng - c2_lng) < (hw1_lng + hw2_lng)
    y_overlap = abs(box1.center_lat - box2.center_lat) < (hh1_lat + hh2_lat)

    return x_overlap and y_overlap


def compute_overlap_amount(box1: ExtentBox, box2: ExtentBox) -> float:
    """Compute approximate overlap distance in km."""
    hw1_lng, hh1_lat = km_to_deg(box1.width_km / 2, box1.height_km / 2, box1.center_lat)
    hw2_lng, hh2_lat = km_to_deg(box2.width_km / 2, box2.height_km / 2, box2.center_lat)

    center_lat = (box1.center_lat + box2.center_lat) / 2

    # Overlap in each axis
    x_gap = abs(box1.center_lng - box2.center_lng) - (hw1_lng + hw2_lng)
    y_gap = abs(box1.center_lat - box2.center_lat) - (hh1_lat + hh2_lat)

    # Negative gap = overlap
    x_overlap_deg = max(0, -x_gap)
    y_overlap_deg = max(0, -y_gap)

    # Convert to km (use the smaller overlap for minimum separation)
    x_overlap_km = x_overlap_deg * km_per_deg_lng(center_lat)
    y_overlap_km = y_overlap_deg * KM_PER_DEG_LAT

    return min(x_overlap_km, y_overlap_km) if x_overlap_km > 0 and y_overlap_km > 0 else 0


def resolve_overlaps(boxes: List[ExtentBox], params: BoxParams) -> List[ExtentBox]:
    """
    Iteratively push overlapping boxes apart.

    Algorithm:
    1. For each pair of overlapping boxes, compute push direction
    2. Move each box by half the overlap distance (up to max_step)
    3. Repeat until no overlaps or max iterations reached

    Args:
        boxes: List of ExtentBox objects (modified in place)
        params: Box generation parameters

    Returns:
        Modified list of boxes
    """
    if len(boxes) < 2:
        return boxes

    # Store original centers for anchor force
    for box in boxes:
        box.original_center_lng = box.center_lng
        box.original_center_lat = box.center_lat

    # Sort boxes deterministically by region_id
    boxes.sort(key=lambda b: b.region_id)

    max_step_deg = params.max_step_km / KM_PER_DEG_LAT

    for iteration in range(params.max_iter):
        overlaps_found = False
        moves = {box.region_id: (0.0, 0.0) for box in boxes}

        # Check all pairs
        for i, box1 in enumerate(boxes):
            for box2 in boxes[i + 1:]:
                if not boxes_overlap(box1, box2):
                    continue

                overlaps_found = True
                overlap_km = compute_overlap_amount(box1, box2)

                if overlap_km <= 0:
                    continue

                # Compute push direction (from box1 center to box2 center)
                dx = box2.center_lng - box1.center_lng
                dy = box2.center_lat - box1.center_lat
                dist = math.sqrt(dx * dx + dy * dy)

                if dist < 0.0001:
                    # Boxes are nearly coincident, push in arbitrary direction
                    dx, dy = 1.0, 0.0
                    dist = 1.0

                # Unit vector
                ux, uy = dx / dist, dy / dist

                # Push amount in degrees (capped)
                center_lat = (box1.center_lat + box2.center_lat) / 2
                overlap_deg = overlap_km / km_per_deg_lng(center_lat)
                push_deg = min(overlap_deg / 2, max_step_deg)

                # Accumulate moves
                m1 = moves[box1.region_id]
                m2 = moves[box2.region_id]
                moves[box1.region_id] = (m1[0] - ux * push_deg, m1[1] - uy * push_deg)
                moves[box2.region_id] = (m2[0] + ux * push_deg, m2[1] + uy * push_deg)

        if not overlaps_found:
            break

        # Apply moves
        for box in boxes:
            move = moves[box.region_id]
            box.center_lng += move[0]
            box.center_lat += move[1]

    return boxes


# =============================================================================
# Polygon Generation
# =============================================================================

def box_to_polygon_wkt(box: ExtentBox) -> str:
    """Convert ExtentBox to WKT polygon string."""
    # Compute half-sizes in degrees
    hw_lng, hh_lat = km_to_deg(box.width_km / 2, box.height_km / 2, box.center_lat)

    # Compute corners in the shifted coordinate space
    min_lng_shifted = box.center_lng - hw_lng
    max_lng_shifted = box.center_lng + hw_lng
    min_lat = box.center_lat - hh_lat
    max_lat = box.center_lat + hh_lat

    # Clamp latitude to valid range
    min_lat = max(-90, min_lat)
    max_lat = min(90, max_lat)

    # Convert back from shifted space to [-180, 180]
    # If lng_shift was 360 (negative values were shifted up), the center is in [0, 360+] range
    # If lng_shift was -360 (positive values were shifted down), the center is in [-360-, 0] range
    min_lng = wrap_longitude(min_lng_shifted)
    max_lng = wrap_longitude(max_lng_shifted)

    # Handle dateline crossing: if min_lng > max_lng after wrapping,
    # the box crosses the dateline. PostGIS can handle this.
    # For example, a box from 170 to -170 (crossing dateline) is valid.

    # Create WKT (closed polygon)
    return f"POLYGON(({min_lng} {min_lat}, {max_lng} {min_lat}, {max_lng} {max_lat}, {min_lng} {max_lat}, {min_lng} {min_lat}))"


# =============================================================================
# Database Operations
# =============================================================================

def get_db_connection():
    """Get database connection from environment."""
    password = os.environ.get('DB_PASSWORD')
    if not password:
        print("Error: DB_PASSWORD environment variable is required")
        sys.exit(1)
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'localhost'),
        port=os.environ.get('DB_PORT', '5432'),
        dbname=os.environ.get('DB_NAME', 'track_regions'),
        user=os.environ.get('DB_USER', 'postgres'),
        password=password,
    )


def fetch_archipelago_regions(
    conn,
    world_view_id: Optional[int] = None,
    region_id: Optional[int] = None
) -> List[dict]:
    """Fetch archipelago regions with their geometries."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if region_id:
            cur.execute("""
                SELECT
                    id, name, parent_region_id, world_view_id,
                    ST_AsBinary(geom) as geom_wkb,
                    is_archipelago
                FROM regions
                WHERE id = %s AND geom IS NOT NULL
            """, (region_id,))
        elif world_view_id:
            cur.execute("""
                SELECT
                    id, name, parent_region_id, world_view_id,
                    ST_AsBinary(geom) as geom_wkb,
                    is_archipelago
                FROM regions
                WHERE world_view_id = %s
                  AND geom IS NOT NULL
                  AND is_archipelago = true
                ORDER BY parent_region_id NULLS FIRST, id
            """, (world_view_id,))
        else:
            cur.execute("""
                SELECT
                    id, name, parent_region_id, world_view_id,
                    ST_AsBinary(geom) as geom_wkb,
                    is_archipelago
                FROM regions
                WHERE geom IS NOT NULL
                  AND is_archipelago = true
                ORDER BY world_view_id, parent_region_id NULLS FIRST, id
            """)

        return cur.fetchall()


def update_extent_box(conn, region_id: int, box: ExtentBox, params: BoxParams):
    """Update region with computed extent box."""
    wkt = box_to_polygon_wkt(box)
    params_json = json.dumps(params.to_dict())

    with conn.cursor() as cur:
        cur.execute("""
            UPDATE regions
            SET extent_box_geom = ST_GeomFromText(%s, 4326),
                extent_box_params = %s::jsonb
            WHERE id = %s
        """, (wkt, params_json, region_id))


def clear_extent_boxes(conn, world_view_id: Optional[int] = None):
    """Clear existing extent boxes."""
    with conn.cursor() as cur:
        if world_view_id:
            cur.execute("""
                UPDATE regions
                SET extent_box_geom = NULL, extent_box_params = NULL
                WHERE world_view_id = %s
            """, (world_view_id,))
        else:
            cur.execute("""
                UPDATE regions
                SET extent_box_geom = NULL, extent_box_params = NULL
            """)


# =============================================================================
# Main Processing
# =============================================================================

def process_regions(
    conn,
    regions: List[dict],
    params: BoxParams,
    verbose: bool = True
) -> int:
    """
    Process regions and generate extent boxes.

    Args:
        conn: Database connection
        regions: List of region records
        params: Box generation parameters
        verbose: Print progress

    Returns:
        Number of boxes generated
    """
    if not regions:
        if verbose:
            print("No archipelago regions found.")
        return 0

    # Group regions by parent for overlap resolution
    by_parent: Dict[Optional[int], List[dict]] = {}
    for region in regions:
        parent_id = region['parent_region_id']
        if parent_id not in by_parent:
            by_parent[parent_id] = []
        by_parent[parent_id].append(region)

    total_generated = 0

    for parent_id, sibling_regions in by_parent.items():
        if verbose:
            parent_name = f"parent={parent_id}" if parent_id else "root level"
            print(f"\nProcessing {len(sibling_regions)} regions under {parent_name}...")

        boxes = []

        # Generate initial boxes for each region
        for region in sibling_regions:
            if not region['geom_wkb']:
                continue

            try:
                points = extract_representative_points(bytes(region['geom_wkb']))
                if not points:
                    if verbose:
                        print(f"  Skipping {region['name']}: no points extracted")
                    continue

                center_lng, center_lat, width_km, height_km, lng_shift = compute_extent_box(
                    points, params
                )

                box = ExtentBox(
                    region_id=region['id'],
                    region_name=region['name'],
                    parent_region_id=region['parent_region_id'],
                    center_lng=center_lng,
                    center_lat=center_lat,
                    width_km=width_km,
                    height_km=height_km,
                    lng_shift=lng_shift,
                )
                boxes.append(box)

                if verbose:
                    print(f"  {region['name']}: {width_km:.0f}x{height_km:.0f} km, "
                          f"shift={lng_shift:.0f}")

            except Exception as e:
                print(f"  Error processing {region['name']}: {e}")
                continue

        # Resolve overlaps among siblings
        if len(boxes) > 1:
            if verbose:
                print(f"  Resolving overlaps among {len(boxes)} boxes...")
            boxes = resolve_overlaps(boxes, params)

        # Save to database
        for box in boxes:
            try:
                update_extent_box(conn, box.region_id, box, params)
                total_generated += 1
            except Exception as e:
                print(f"  Error saving box for region {box.region_id}: {e}")

    conn.commit()
    return total_generated


def main():
    parser = argparse.ArgumentParser(
        description='Generate extent boxes for archipelago regions'
    )
    parser.add_argument('--world-view-id', type=int, help='Process specific world view')
    parser.add_argument('--region-id', type=int, help='Process specific region')
    parser.add_argument('--all', action='store_true', help='Process all archipelago regions')
    parser.add_argument('--clear', action='store_true', help='Clear existing boxes first')
    parser.add_argument('--quiet', action='store_true', help='Suppress progress output')

    # Box parameters
    parser.add_argument('--pad-km', type=float, default=30.0, help='Padding in km')
    parser.add_argument('--min-w-km', type=float, default=250.0, help='Minimum width in km')
    parser.add_argument('--min-h-km', type=float, default=250.0, help='Minimum height in km')
    parser.add_argument('--max-aspect', type=float, default=2.5, help='Maximum aspect ratio')

    args = parser.parse_args()

    if not args.world_view_id and not args.region_id and not args.all:
        parser.error("Must specify --world-view-id, --region-id, or --all")

    if not HAS_SHAPELY:
        print("Error: shapely library is required. Install with: pip install shapely")
        sys.exit(1)

    params = BoxParams(
        pad_km=args.pad_km,
        min_w_km=args.min_w_km,
        min_h_km=args.min_h_km,
        max_aspect=args.max_aspect,
    )

    verbose = not args.quiet

    try:
        conn = get_db_connection()

        if args.clear:
            if verbose:
                print("Clearing existing extent boxes...")
            clear_extent_boxes(conn, args.world_view_id)
            conn.commit()

        regions = fetch_archipelago_regions(
            conn,
            world_view_id=args.world_view_id,
            region_id=args.region_id,
        )

        if verbose:
            print(f"Found {len(regions)} archipelago region(s) to process")

        count = process_regions(conn, regions, params, verbose)

        if verbose:
            print(f"\nGenerated {count} extent box(es)")

        conn.close()

    except psycopg2.Error:
        print("Database error: could not connect or query failed")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
