#!/usr/bin/env python3
"""
Compute merged geometries for all GADM administrative division levels.

After loading GADM data, only leaf divisions have geometry. This script
computes geometry for parent divisions (countries, continents, etc.) by
merging their children's geometries.

Works bottom-up: districts → states → countries → continents

Usage:
    python precalculate-geometries.py
"""

import os
import signal
import sys
import time
from datetime import timedelta

import psycopg2
from dotenv import load_dotenv

# Global connection for signal handler
_conn = None


def signal_handler(signum, frame):
    """Handle Ctrl+C by canceling the current query."""
    global _conn
    if _conn:
        print("\n\n⚠️  Canceling current query...")
        try:
            _conn.cancel()
        except Exception:
            pass
    sys.exit(1)


# Register signal handler
signal.signal(signal.SIGINT, signal_handler)


def get_db_credentials():
    """Load database credentials from environment."""
    env_files = [".env", "../.env", "../../.env"]
    for env_file in env_files:
        if os.path.exists(env_file):
            print(f"Loading environment from {env_file}")
            load_dotenv(env_file, override=True)
            break

    db_name = os.getenv("DB_NAME")
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")
    db_host = os.getenv("DB_HOST", "localhost")

    if not all([db_name, db_user, db_password]):
        print("Error: DB_NAME, DB_USER, and DB_PASSWORD must be set in .env")
        sys.exit(1)

    return db_name, db_user, db_password, db_host


def get_non_leaf_divisions_without_geom(cursor):
    """Get all non-leaf administrative divisions that don't have geometry yet.

    Orders by depth (deepest first) so we process divisions with fewer
    descendants first - these are much faster to compute.
    """
    print("  Finding non-leaf divisions without geometry (ordered by depth)...", end=" ", flush=True)
    cursor.execute("""
        WITH RECURSIVE division_depth AS (
            SELECT id, name, 0 as depth
            FROM administrative_divisions
            WHERE parent_id IS NULL

            UNION ALL

            SELECT d.id, d.name, dd.depth + 1
            FROM administrative_divisions d
            INNER JOIN division_depth dd ON d.parent_id = dd.id
        )
        SELECT dd.id, dd.name, dd.depth
        FROM division_depth dd
        INNER JOIN administrative_divisions d ON dd.id = d.id
        WHERE d.has_children = true
          AND d.geom IS NULL
        ORDER BY dd.depth DESC
    """)
    result = cursor.fetchall()
    print(f"found {len(result):,}")
    return [(r[0], r[1]) for r in result]


def calculate_merged_geometry(cursor, division_id, debug=False):
    """Calculate merged geometry for a single division from its direct children.

    Since we process bottom-up (deepest first), all children already have
    their geometry computed, so we just need to merge direct children.

    Simplification is adaptive based on:
    - Point density (points per square degree) - keeps detail where it matters
    - Target: aim for ~5000-10000 points per division for good balance
    """
    if debug:
        # Get debug info
        cursor.execute("""
            SELECT
                d.name,
                (SELECT COUNT(*) FROM administrative_divisions WHERE parent_id = d.id) as child_count,
                (SELECT COUNT(*) FROM administrative_divisions WHERE parent_id = d.id AND geom IS NOT NULL) as children_with_geom,
                (SELECT SUM(ST_NPoints(geom)) FROM administrative_divisions WHERE parent_id = d.id AND geom IS NOT NULL) as total_points
            FROM administrative_divisions d WHERE d.id = %s
        """, (division_id,))
        info = cursor.fetchone()
        if info:
            name, child_count, children_with_geom, total_points = info
            print(f"\n    -> {name}: {child_count} children, {children_with_geom} with geom, {total_points or 0:,} points", end="", flush=True)

    start = time.perf_counter()

    # Merge children and apply adaptive simplification
    # The tolerance is calculated to reduce complex geometries while preserving simple ones
    # ST_MakeValid fixes any topology errors before processing
    # ST_CollectionExtract(geom, 3) extracts only polygons (type 3) to avoid GeometryCollection errors
    cursor.execute("""
        WITH merged AS (
            SELECT ST_Multi(ST_Union(ST_MakeValid(geom))) as merged_geom
            FROM administrative_divisions
            WHERE parent_id = %s
              AND geom IS NOT NULL
        ),
        validated AS (
            SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(merged_geom), 3)) as merged_geom
            FROM merged
        ),
        analyzed AS (
            SELECT
                merged_geom,
                ST_NPoints(merged_geom) as point_count,
                -- Area in square degrees (approximate)
                ST_Area(merged_geom::geography) / 1000000000 as area_sq_deg,
                -- Bounding box diagonal for reference
                CASE
                    WHEN merged_geom IS NOT NULL THEN
                        GREATEST(
                            ST_XMax(merged_geom) - ST_XMin(merged_geom),
                            ST_YMax(merged_geom) - ST_YMin(merged_geom)
                        )
                    ELSE 0
                END as bbox_size
            FROM validated
        ),
        tolerance_calc AS (
            SELECT
                merged_geom,
                point_count,
                area_sq_deg,
                bbox_size,
                -- Target: ~5000 points is a good balance
                -- Calculate tolerance to achieve roughly this target
                -- More points = higher tolerance needed
                CASE
                    -- Already simple enough, no simplification
                    WHEN point_count < 5000 THEN 0
                    -- Moderate complexity: light simplification
                    WHEN point_count < 20000 THEN 0.0005
                    -- High complexity: medium simplification
                    WHEN point_count < 50000 THEN 0.001
                    -- Very high complexity: stronger simplification
                    WHEN point_count < 100000 THEN 0.005
                    -- Extremely complex: heavy simplification
                    ELSE 0.01
                END as tolerance
            FROM analyzed
        )
        UPDATE administrative_divisions
        SET
            geom = CASE
                WHEN tolerance_calc.tolerance = 0 THEN tolerance_calc.merged_geom
                ELSE ST_SimplifyPreserveTopology(tolerance_calc.merged_geom, tolerance_calc.tolerance)
            END
        FROM tolerance_calc
        WHERE administrative_divisions.id = %s
          AND tolerance_calc.merged_geom IS NOT NULL
    """, (division_id, division_id))

    if debug:
        elapsed = time.perf_counter() - start
        # Also show resulting point count
        cursor.execute("SELECT ST_NPoints(geom) FROM administrative_divisions WHERE id = %s", (division_id,))
        result = cursor.fetchone()
        result_points = result[0] if result and result[0] else 0
        print(f" -> {result_points:,} pts ({elapsed:.2f}s)", end="", flush=True)

    return cursor.rowcount > 0


def precalculate_all_geometries(conn, cursor, batch_size=100):
    """Pre-calculate merged geometries for all non-leaf administrative divisions."""
    divisions = get_non_leaf_divisions_without_geom(cursor)
    total = len(divisions)

    if total == 0:
        print("\nAll non-leaf divisions already have geometries. Nothing to do.")
        return

    print(f"\nComputing merged geometries for {total:,} non-leaf divisions...")
    print(f"(Committing every {batch_size} divisions - safe to interrupt with Ctrl+C)")
    print()
    print("=" * 70)
    print("Recent regions:")
    print("-" * 70)

    start_time = time.perf_counter()
    last_print_time = start_time
    last_processed = 0
    processed = 0
    updated = 0
    bar_width = 40
    print_interval = 0.5  # Print every 0.5 seconds
    speed = 999  # Initialize speed high
    smoothed_speed = None  # Exponential moving average of speed
    alpha = 0.3  # Smoothing factor (higher = more weight on recent speed)

    # Keep track of recent regions for display
    recent_regions = []  # List of (name, children, points_before, points_after, time)
    max_recent = 10

    def render_display():
        """Render the display with recent regions and progress bar."""
        nonlocal smoothed_speed

        # Calculate how many lines to go up (regions + progress bar)
        lines_to_clear = max_recent + 2

        # Move cursor up and clear
        sys.stdout.write(f"\033[{lines_to_clear}A")

        # Print recent regions (pad to max_recent lines)
        display_regions = recent_regions[-max_recent:]
        for i in range(max_recent):
            sys.stdout.write("\033[K")  # Clear line
            if i < len(display_regions):
                name, children, pts_before, pts_after, elapsed = display_regions[i]
                if pts_before > 0:
                    reduction = (1 - pts_after / pts_before) * 100 if pts_before > pts_after else 0
                    sys.stdout.write(f"  {name}: {children} children, {pts_before:,} → {pts_after:,} pts (-{reduction:.0f}%) [{elapsed:.2f}s]\n")
                else:
                    sys.stdout.write(f"  {name}: {children} children, no geometry\n")
            else:
                sys.stdout.write("\n")

        # Print separator and progress bar
        sys.stdout.write("\033[K")  # Clear line
        sys.stdout.write("-" * 70 + "\n")

        sys.stdout.write("\033[K")  # Clear line
        pct = processed / total if total > 0 else 0
        remaining = total - processed
        eta = remaining / smoothed_speed if smoothed_speed and smoothed_speed > 0 else 0
        filled = int(bar_width * pct)
        bar = "█" * filled + "░" * (bar_width - filled)
        sys.stdout.write(f"  [{bar}] {pct*100:5.1f}% {processed:,}/{total:,} "
              f"{smoothed_speed or 0:.0f}/s ETA:{timedelta(seconds=int(eta))}\n")
        sys.stdout.flush()

    # Print initial empty lines to reserve space for the display area
    for _ in range(max_recent):
        print()
    print("-" * 70)
    print()

    try:
        for division_id, name in divisions:
            division_start = time.perf_counter()

            # Get info before processing
            cursor.execute("""
                SELECT
                    (SELECT COUNT(*) FROM administrative_divisions WHERE parent_id = %s) as child_count,
                    (SELECT SUM(ST_NPoints(geom)) FROM administrative_divisions WHERE parent_id = %s AND geom IS NOT NULL) as total_points
            """, (division_id, division_id))
            info = cursor.fetchone()
            child_count = info[0] if info else 0
            points_before = info[1] if info and info[1] else 0

            if calculate_merged_geometry(cursor, division_id, debug=False):
                updated += 1
            processed += 1

            # Get resulting points
            cursor.execute("SELECT ST_NPoints(geom) FROM administrative_divisions WHERE id = %s", (division_id,))
            result = cursor.fetchone()
            points_after = result[0] if result and result[0] else 0

            division_elapsed = time.perf_counter() - division_start

            # Add to recent divisions
            recent_regions.append((name, child_count, points_before, points_after, division_elapsed))
            if len(recent_regions) > max_recent * 2:  # Keep some buffer
                recent_regions = recent_regions[-max_recent:]

            # Commit in batches - this saves progress and allows interruption
            if processed % batch_size == 0:
                conn.commit()

            # Update display periodically
            current_time = time.perf_counter()
            if current_time - last_print_time >= print_interval or processed == total:
                interval_elapsed = current_time - last_print_time
                interval_processed = processed - last_processed

                # Calculate instant speed for this interval
                instant_speed = interval_processed / interval_elapsed if interval_elapsed > 0 else 0

                # Update smoothed speed (exponential moving average)
                if smoothed_speed is None:
                    smoothed_speed = instant_speed
                else:
                    smoothed_speed = alpha * instant_speed + (1 - alpha) * smoothed_speed

                speed = smoothed_speed
                last_print_time = current_time
                last_processed = processed

                render_display()

        # Final commit
        conn.commit()

        elapsed = time.perf_counter() - start_time
        print()
        print("=" * 70)
        print(f"  ✓ Completed in {timedelta(seconds=int(elapsed))}")
        print(f"  ✓ Updated {updated:,} divisions with merged geometries")

    except KeyboardInterrupt:
        print(f"\n\n⚠️  Interrupted! Committing current batch...")
        conn.commit()
        print(f"  ✓ Saved progress: {processed:,}/{total:,} processed, {updated:,} updated")
        print(f"  Run the script again to continue from where you left off.")
        sys.exit(0)


def print_stats(cursor):
    """Print statistics about geometries."""
    print("\n" + "="*50)
    print("Geometry Statistics:")
    print("="*50)

    cursor.execute("SELECT COUNT(*) FROM administrative_divisions")
    total = cursor.fetchone()[0]
    print(f"  Total divisions: {total:,}")

    cursor.execute("SELECT COUNT(*) FROM administrative_divisions WHERE has_children = true")
    non_leaf = cursor.fetchone()[0]
    print(f"  Non-leaf divisions: {non_leaf:,}")

    cursor.execute("SELECT COUNT(*) FROM administrative_divisions WHERE geom IS NOT NULL")
    with_geom = cursor.fetchone()[0]
    print(f"  Divisions with geometry: {with_geom:,}")

    cursor.execute("SELECT COUNT(*) FROM administrative_divisions WHERE has_children = true AND geom IS NULL")
    missing = cursor.fetchone()[0]
    print(f"  Non-leaf divisions missing geometry: {missing:,}")

    cursor.execute("""
        SELECT
            pg_size_pretty(SUM(ST_MemSize(geom))) as full,
            pg_size_pretty(SUM(ST_MemSize(geom_simplified_low))) as low,
            pg_size_pretty(SUM(ST_MemSize(geom_simplified_medium))) as medium
        FROM administrative_divisions
        WHERE geom IS NOT NULL
    """)
    sizes = cursor.fetchone()
    if sizes[0]:
        print(f"  Geometry sizes:")
        print(f"    - Full: {sizes[0]}")
        print(f"    - Medium (simplified): {sizes[2]}")
        print(f"    - Low (simplified): {sizes[1]}")

    print("="*50)


def main():
    global _conn
    db_name, db_user, db_password, db_host = get_db_credentials()

    print(f"Connecting to PostgreSQL database {db_name}@{db_host}...", end=" ")
    try:
        conn = psycopg2.connect(
            dbname=db_name,
            user=db_user,
            password=db_password,
            host=db_host,
            port=5432,
        )
        _conn = conn  # Store for signal handler
        cursor = conn.cursor()
    except psycopg2.OperationalError:
        print(f"\nError: Could not connect to database {db_name}@{db_host}")
        sys.exit(1)
    print("done.")

    try:
        precalculate_all_geometries(conn, cursor)
        print_stats(cursor)
        print("\n✓ Pre-calculation complete!")
    except Exception as e:
        print(f"\nError: {e}")
        conn.rollback()
        sys.exit(1)
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    main()
