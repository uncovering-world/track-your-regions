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
from concurrent.futures import ThreadPoolExecutor, as_completed
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


def get_non_leaf_divisions_by_depth(cursor):
    """Get all non-leaf administrative divisions without geometry, grouped by depth.

    Returns a list of (depth, divisions) tuples, deepest first.
    Within a depth level, divisions are independent and can be parallelized.
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

    # Group by depth level
    from collections import OrderedDict
    levels = OrderedDict()
    for div_id, name, depth in result:
        levels.setdefault(depth, []).append((div_id, name))

    total = len(result)
    print(f"found {total:,} across {len(levels)} depth levels")
    return total, levels


def calculate_merged_geometry(cursor, division_id, debug=False):
    """Calculate merged geometry for a single division from its direct children.

    Since we process bottom-up (deepest first), all children already have
    their geometry computed, so we just need to merge direct children.

    Rule 1: geom is sacred — no simplification applied to source geometry.
    Full-resolution geometry is stored; triggers handle simplified columns.

    Uses ST_CoverageUnion when possible (faster for valid coverages),
    falls back to ST_Union(ST_MakeValid()) on error.
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

    # Try ST_CoverageUnion first (faster for valid coverages, removes shared edges)
    # Fall back to ST_Union(ST_MakeValid()) if it fails
    used_coverage_union = False
    cursor.execute("SAVEPOINT try_coverage_union")
    try:
        cursor.execute("""
            WITH merged AS (
                SELECT ST_CoverageUnion(geom) as merged_geom
                FROM administrative_divisions
                WHERE parent_id = %s
                  AND geom IS NOT NULL
            )
            UPDATE administrative_divisions
            SET geom = validate_multipolygon(merged.merged_geom)
            FROM merged
            WHERE administrative_divisions.id = %s
              AND merged.merged_geom IS NOT NULL
        """, (division_id, division_id))
        cursor.execute("RELEASE SAVEPOINT try_coverage_union")
        used_coverage_union = True
    except Exception:
        cursor.execute("ROLLBACK TO SAVEPOINT try_coverage_union")
        cursor.execute("""
            WITH merged AS (
                SELECT ST_Union(ST_MakeValid(geom)) as merged_geom
                FROM administrative_divisions
                WHERE parent_id = %s
                  AND geom IS NOT NULL
            )
            UPDATE administrative_divisions
            SET geom = validate_multipolygon(merged.merged_geom)
            FROM merged
            WHERE administrative_divisions.id = %s
              AND merged.merged_geom IS NOT NULL
        """, (division_id, division_id))

    if debug:
        elapsed = time.perf_counter() - start
        cursor.execute("SELECT ST_NPoints(geom) FROM administrative_divisions WHERE id = %s", (division_id,))
        result = cursor.fetchone()
        result_points = result[0] if result and result[0] else 0
        method = "CovUnion" if used_coverage_union else "Union"
        print(f" -> {result_points:,} pts ({method}, {elapsed:.2f}s)", end="", flush=True)

    return cursor.rowcount > 0


def _merge_worker(division_ids, db_params):
    """Worker thread: merge geometry for a batch of divisions using its own DB connection."""
    conn = psycopg2.connect(**db_params)
    conn.autocommit = False
    cursor = conn.cursor()
    results = []

    for division_id, name in division_ids:
        start = time.perf_counter()

        # Get child info
        cursor.execute("""
            SELECT
                (SELECT COUNT(*) FROM administrative_divisions WHERE parent_id = %s),
                (SELECT SUM(ST_NPoints(geom)) FROM administrative_divisions WHERE parent_id = %s AND geom IS NOT NULL)
        """, (division_id, division_id))
        info = cursor.fetchone()
        child_count = info[0] if info else 0
        points_before = info[1] if info and info[1] else 0

        # Try ST_CoverageUnion first, fall back to ST_Union
        used_coverage = False
        cursor.execute("SAVEPOINT try_cov")
        try:
            cursor.execute("""
                WITH merged AS (
                    SELECT ST_CoverageUnion(geom) as merged_geom
                    FROM administrative_divisions
                    WHERE parent_id = %s AND geom IS NOT NULL
                )
                UPDATE administrative_divisions
                SET geom = validate_multipolygon(merged.merged_geom)
                FROM merged
                WHERE administrative_divisions.id = %s AND merged.merged_geom IS NOT NULL
            """, (division_id, division_id))
            cursor.execute("RELEASE SAVEPOINT try_cov")
            used_coverage = True
        except Exception:
            cursor.execute("ROLLBACK TO SAVEPOINT try_cov")
            cursor.execute("""
                WITH merged AS (
                    SELECT ST_Union(ST_MakeValid(geom)) as merged_geom
                    FROM administrative_divisions
                    WHERE parent_id = %s AND geom IS NOT NULL
                )
                UPDATE administrative_divisions
                SET geom = validate_multipolygon(merged.merged_geom)
                FROM merged
                WHERE administrative_divisions.id = %s AND merged.merged_geom IS NOT NULL
            """, (division_id, division_id))

        # Commit so other workers can see this division's geometry
        conn.commit()

        # Get result points
        cursor.execute("SELECT ST_NPoints(geom) FROM administrative_divisions WHERE id = %s", (division_id,))
        result = cursor.fetchone()
        points_after = result[0] if result and result[0] else 0
        elapsed = time.perf_counter() - start

        results.append((name, child_count, points_before, points_after, elapsed))

    cursor.close()
    conn.close()
    return results


def _get_db_params():
    """Get DB connection params from environment."""
    return dict(
        dbname=os.environ.get("DB_NAME", "track_regions"),
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ.get("DB_PASSWORD", "postgres"),
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
    )


def precalculate_all_geometries(conn, cursor, workers=8):
    """Pre-calculate merged geometries for all non-leaf administrative divisions.

    Processes depth levels bottom-up (deepest first). Within each level,
    divisions are independent and run in parallel across worker threads.
    """
    total, levels = get_non_leaf_divisions_by_depth(cursor)

    if total == 0:
        print("\nAll non-leaf divisions already have geometries. Nothing to do.")
        return

    print(f"\nComputing merged geometries for {total:,} non-leaf divisions with {workers} workers...")
    print(f"(Processing {len(levels)} depth levels bottom-up)")

    start_time = time.perf_counter()
    processed = 0
    db_params = _get_db_params()

    try:
        for depth, divisions in levels.items():
            level_start = time.perf_counter()
            level_count = len(divisions)

            actual_workers = min(workers, level_count)

            print(f"\n  Depth {depth}: {level_count:,} divisions ({actual_workers} workers)...")

            if actual_workers == 1:
                # Sequential on main connection
                for division_id, name in divisions:
                    calculate_merged_geometry(cursor, division_id, debug=(level_count <= 20))
                    processed += 1
                conn.commit()
            else:
                # Parallel with thread pool
                chunk_size = (level_count + actual_workers - 1) // actual_workers
                chunks = [divisions[i:i + chunk_size] for i in range(0, level_count, chunk_size)]

                with ThreadPoolExecutor(max_workers=actual_workers) as executor:
                    futures = [executor.submit(_merge_worker, chunk, db_params) for chunk in chunks]
                    for future in as_completed(futures):
                        results = future.result()
                        processed += len(results)
                        # Show notable regions (>1s or >100K points)
                        for name, children, pts_before, pts_after, elapsed in results:
                            if elapsed > 1.0 or pts_before > 100_000:
                                print(f"    {name}: {children} children, {pts_before:,} → {pts_after:,} pts [{elapsed:.1f}s]")

            level_elapsed = time.perf_counter() - level_start
            total_elapsed = time.perf_counter() - start_time
            print(f"    Level {depth} done ({level_count:,} divisions in {level_elapsed:.1f}s) — {processed:,}/{total:,} total ({total_elapsed:.0f}s)")

        # Final
        elapsed = time.perf_counter() - start_time
        print(f"\n{'=' * 70}")
        print(f"  Completed {total:,} divisions in {timedelta(seconds=int(elapsed))}")

        # Apply coverage-aware simplification for gap-free borders
        run_coverage_simplification(conn, cursor, workers=workers)

    except KeyboardInterrupt:
        print(f"\n\n  Interrupted! Progress: {processed:,}/{total:,} processed")
        print(f"  Run the script again to continue from where you left off.")
        sys.exit(0)


def _simplify_worker(parent_ids_chunk, db_params):
    """Worker thread: simplify a chunk of parent groups using its own DB connection."""
    conn = psycopg2.connect(**db_params)
    conn.autocommit = True
    cursor = conn.cursor()
    failed = 0
    for parent_id in parent_ids_chunk:
        try:
            cursor.execute("SELECT simplify_coverage_siblings(%s)", (parent_id,))
        except Exception:
            failed += 1
    cursor.close()
    conn.close()
    return len(parent_ids_chunk), failed


def run_coverage_simplification(conn, cursor, workers=8):
    """Apply coverage-aware simplification to sibling divisions.

    Uses ST_CoverageSimplify (PostGIS 3.6+) to create gap-free simplified
    versions of adjacent divisions that share borders. This replaces the
    per-row trigger-based simplification with topology-preserving results.

    Runs in parallel with multiple DB connections since each group is independent.
    """
    print("\nApplying coverage-aware simplification to sibling groups...")

    cursor.execute("""
        SELECT DISTINCT parent_id
        FROM administrative_divisions
        WHERE parent_id IS NOT NULL
          AND geom IS NOT NULL
        ORDER BY parent_id
    """)
    parent_ids = [row[0] for row in cursor.fetchall()]
    conn.commit()  # Release read lock before spawning parallel workers

    total = len(parent_ids)
    db_params = _get_db_params()
    print(f"  Processing {total:,} parent groups with {workers} workers...")
    start = time.perf_counter()

    # Split into chunks — one per worker
    chunk_size = (total + workers - 1) // workers
    chunks = [parent_ids[i:i + chunk_size] for i in range(0, total, chunk_size)]

    completed = 0
    total_failed = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(_simplify_worker, chunk, db_params) for chunk in chunks]
        for future in as_completed(futures):
            done, failed = future.result()
            completed += done
            total_failed += failed
            elapsed = time.perf_counter() - start
            print(f"    {completed:,}/{total:,} groups ({elapsed:.1f}s)")

    if total_failed > 0:
        print(f"  Warning: {total_failed} groups failed (per-row trigger simplification used as fallback)")

    elapsed = time.perf_counter() - start
    print(f"  Coverage simplification complete for {total:,} groups ({elapsed:.1f}s)")


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
