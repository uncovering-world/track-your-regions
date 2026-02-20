#!/usr/bin/env python3
"""
Initialize the new-gen database from GADM GeoPackage file.

This script loads GADM administrative divisions into the database.
It creates the administrative_divisions table with pre-simplified geometries
for different zoom levels.

Requires schema from 01-schema.sql to be loaded first (Docker handles this automatically).

Usage:
    python init-db.py -s /path/to/gadm_410.gpkg -g
"""

import argparse
import os
import sqlite3
import sys
import time
from datetime import timedelta

import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

try:
    from osgeo import ogr
    ogr.UseExceptions()
    HAS_GDAL = True
except ImportError:
    HAS_GDAL = False
    print("Warning: GDAL/OGR not available. Geometry import will be skipped.")


class DatabaseConnectionManager:
    """Manages PostgreSQL and SQLite connections."""

    def __init__(self, db_host, db_name, db_user, db_password, gadm_file=None):
        self.db_host = db_host
        self.db_name = db_name
        self.db_user = db_user
        self.db_password = db_password
        self.gadm_file = gadm_file
        self.conn_pg = None
        self.cur_pg = None
        self.conn_sqlite = None
        self.cur_sqlite = None

    def __enter__(self):
        print(f"Connecting to PostgreSQL database {self.db_name}@{self.db_host}...", end=" ")
        try:
            self.conn_pg = psycopg2.connect(
                dbname=self.db_name,
                user=self.db_user,
                password=self.db_password,
                host=self.db_host,
                port=5432,
            )
            self.cur_pg = self.conn_pg.cursor()
        except psycopg2.OperationalError as e:
            print(f"\nError: Could not connect to database: {e}")
            sys.exit(1)
        print("done.")

        if self.gadm_file:
            print(f"Opening {self.gadm_file} as SQLite database...", end=" ")
            try:
                self.conn_sqlite = sqlite3.connect(self.gadm_file)
                self.cur_sqlite = self.conn_sqlite.cursor()
            except sqlite3.OperationalError as e:
                print(f"\nError: Could not open GADM file: {e}")
                sys.exit(1)
            print("done.")

        return self.conn_pg, self.cur_pg, self.cur_sqlite

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if self.conn_pg:
                if exc_type is None:
                    self.conn_pg.commit()
                else:
                    self.conn_pg.rollback()
        finally:
            if self.cur_pg:
                self.cur_pg.close()
            if self.conn_pg:
                self.conn_pg.close()
            if self.cur_sqlite:
                self.cur_sqlite.close()
            if self.conn_sqlite:
                self.conn_sqlite.close()


class ProgressTracker:
    """Tracks and displays progress for long-running operations."""

    def __init__(self, total_items, item_name="items"):
        self.start_time = time.perf_counter()
        self.total_items = total_items
        self.item_name = item_name
        self.current = 0
        self.print_interval = max(1, total_items // 100)

    def update(self, count=1):
        self.current += count
        if self.current % self.print_interval == 0 or self.current == self.total_items:
            self._print_progress()

    def _print_progress(self):
        elapsed = time.perf_counter() - self.start_time
        pct = self.current / self.total_items if self.total_items > 0 else 1
        eta = (elapsed / pct - elapsed) if pct > 0 else 0
        print(f"\r  {pct*100:5.1f}% ({self.current}/{self.total_items} {self.item_name}) "
              f"- Elapsed: {timedelta(seconds=int(elapsed))} "
              f"- ETA: {timedelta(seconds=int(eta))}", end="", flush=True)

    def finish(self):
        elapsed = time.perf_counter() - self.start_time
        print(f"\n  Completed {self.total_items} {self.item_name} in {timedelta(seconds=int(elapsed))}")


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


class Division:
    """Represents an administrative division with metadata for optimization."""
    def __init__(self, name, division_id, parent_id, parent_path, parent_name, path):
        self.name = name
        self.id = division_id
        self.parent_id = parent_id
        self.parent_path = parent_path
        self.parent_name = parent_name
        self.path = path
        self.children_num = 0
        self.single_child = None


class GADMProcessor:
    """Processes GADM GeoPackage file and loads data into PostgreSQL."""

    # Geographical levels in GADM
    SUBCOUNTRY_LEVELS = ["SOVEREIGN", "GOVERNEDBY"]
    GEO_LEVELS = (
        ["CONTINENT", "SUBCONT"]
        + SUBCOUNTRY_LEVELS
        + ["COUNTRY", "REGION"]
        + [f"NAME_{i}" for i in range(6)]
    )
    PROPERTIES = GEO_LEVELS + ["UID"]

    # Commit every N records during bulk import to limit transaction size
    COMMIT_INTERVAL = 10000

    def __init__(self, pg_cursor, sqlite_cursor, pg_conn, gadm_file, include_geometry=True, postprocess=True):
        self.pg_cursor = pg_cursor
        self.sqlite_cursor = sqlite_cursor
        self.pg_conn = pg_conn
        self.gadm_file = gadm_file
        self.include_geometry = include_geometry and HAS_GDAL
        self.postprocess = postprocess

        self.table_name = self._get_gadm_table_name()
        self.existing_divisions = {}  # path -> Division object
        self.geometries = {}  # gadm_uid -> WKB geometry
        self.single_children = []  # List of divisions that are single children
        self.record_count = self._count_records()

    def _get_gadm_table_name(self):
        """Find the main data table in the GeoPackage."""
        self.sqlite_cursor.execute("""
            SELECT name FROM sqlite_master
            WHERE type='table'
              AND name NOT LIKE 'sqlite_%'
              AND name NOT LIKE 'rtree_%'
              AND name NOT LIKE 'idx_%'
              AND name NOT LIKE 'gidx_%'
              AND name NOT LIKE 'gpkg_%'
        """)
        layers = [row[0] for row in self.sqlite_cursor.fetchall()]
        if not layers:
            print("Error: No data tables found in GeoPackage")
            sys.exit(1)
        return layers[0]

    def _count_records(self):
        """Count total records in GADM file."""
        self.sqlite_cursor.execute(f'SELECT COUNT(*) FROM "{self.table_name}"')
        return self.sqlite_cursor.fetchone()[0]

    def load_geometries_into_memory(self):
        """Pre-load all geometries into memory for faster processing."""
        if not self.include_geometry:
            return

        print("\nLoading geometries into memory...")
        ds = ogr.Open(self.gadm_file)
        if ds is None:
            print(f"Error: Could not open {self.gadm_file} with GDAL")
            sys.exit(1)

        layer = ds.GetLayerByName(self.table_name)
        progress = ProgressTracker(layer.GetFeatureCount(), "geometries")

        for feature in layer:
            gadm_uid = feature.GetField("UID")
            geom = feature.GetGeometryRef()
            if geom:
                self.geometries[gadm_uid] = geom.ExportToWkb()
            progress.update()

        progress.finish()
        ds = None  # Close dataset

    def process_records(self):
        """Process all GADM records and insert into database.

        Disables simplification and 3857 triggers during bulk insert to avoid
        5 expensive PostGIS operations per row. These get computed in a single
        batch pass afterward (and then overwritten by coverage-aware
        simplification in precalculate-geometries.py).
        """
        print("\nProcessing GADM records...")

        # Disable triggers that fire on each INSERT — huge speedup for bulk import.
        # Each leaf INSERT would otherwise trigger:
        #   trigger_simplify_geom: 2 simplification ops (4326)
        #   trg_admin_div_geom_3857: 1 transform + 2 simplification ops (3857)
        # These results get overwritten by precalculate-geometries.py anyway.
        if self.include_geometry:
            print("  Disabling geometry triggers for bulk import...")
            self.pg_cursor.execute("""
                ALTER TABLE administrative_divisions DISABLE TRIGGER trigger_simplify_geom;
                ALTER TABLE administrative_divisions DISABLE TRIGGER trg_admin_div_geom_3857;
            """)
            self.pg_conn.commit()

        cols = ", ".join(self.PROPERTIES)
        self.sqlite_cursor.execute(f'SELECT {cols} FROM "{self.table_name}"')

        progress = ProgressTracker(self.record_count, "records")

        for row in self.sqlite_cursor:
            self._process_row(dict(zip(self.PROPERTIES, row)))
            progress.update()

            # Periodic commits to limit transaction size and memory
            if progress.current % self.COMMIT_INTERVAL == 0:
                self.pg_conn.commit()

        self.pg_conn.commit()
        progress.finish()

        if self.include_geometry:
            # Batch-compute 3857 transforms and per-row simplification
            # while triggers are still disabled. Much faster than per-row
            # trigger execution: single UPDATE pass instead of 356K triggers.
            # Note: precalculate-geometries.py overwrites simplified columns
            # with coverage-aware versions, but we need the per-row fallback
            # for divisions that don't get coverage simplification.
            self._batch_compute_derived_columns()

            # Re-enable triggers for subsequent operations
            print("  Re-enabling geometry triggers...")
            self.pg_cursor.execute("""
                ALTER TABLE administrative_divisions ENABLE TRIGGER trigger_simplify_geom;
                ALTER TABLE administrative_divisions ENABLE TRIGGER trg_admin_div_geom_3857;
            """)
            self.pg_conn.commit()

    def _process_row(self, record):
        """Process a single GADM record."""
        # Identify subcountry level
        subcountry_level = None
        for level in self.SUBCOUNTRY_LEVELS:
            if record.get(level):
                subcountry_level = level
                break

        division_path_parts = []
        last_parent_id = None
        last_parent_path = None
        last_parent_name = None

        # Process each geographical level
        for level in self.GEO_LEVELS:
            name = record.get(level)
            if not name:
                continue

            # Skip unnecessary subcountry levels
            if level in self.SUBCOUNTRY_LEVELS:
                if level != subcountry_level:
                    continue
                if name == record.get("COUNTRY"):
                    continue

            # Skip NAME_0 if it's the same as country and next level exists
            if level == "NAME_0" and name == record.get("COUNTRY"):
                if self._has_next_level(record, level):
                    continue
                # Update existing country division with geometry
                uid = record.get("UID")
                geom = self.geometries.get(uid) if self.include_geometry else None
                if last_parent_id and geom:
                    self.pg_cursor.execute("""
                        UPDATE administrative_divisions
                        SET gadm_uid = %s,
                            geom = CASE WHEN %s IS NULL THEN geom ELSE validate_multipolygon(ST_GeomFromWKB(%s, 4326)) END,
                            has_children = FALSE
                        WHERE id = %s
                    """, (uid, geom, geom, last_parent_id))
                continue

            # Build unique path for this division
            division_path_parts.append(name)
            path = "_".join(division_path_parts)

            # Check if next level exists (determines has_children)
            has_children = self._has_next_level(record, level)

            # Get or create division
            if path not in self.existing_divisions:
                division_id = self._insert_division(
                    name=name,
                    parent_id=last_parent_id,
                    has_children=has_children,
                    gadm_uid=record.get("UID") if not has_children else None,
                    geom=self.geometries.get(record.get("UID")) if not has_children else None
                )

                division = Division(
                    name=name,
                    division_id=division_id,
                    parent_id=last_parent_id,
                    parent_path=last_parent_path,
                    parent_name=last_parent_name,
                    path=path
                )
                self.existing_divisions[path] = division

                # Track single children for postprocessing
                if self.postprocess and last_parent_path:
                    parent_division = self.existing_divisions.get(last_parent_path)
                    if parent_division:
                        parent_division.children_num += 1
                        if parent_division.children_num == 1:
                            self.single_children.append(division)
                            parent_division.single_child = division
                        elif parent_division.children_num == 2:
                            # No longer a single child
                            sibling = parent_division.single_child
                            if sibling in self.single_children:
                                self.single_children.remove(sibling)
                            parent_division.single_child = None
            else:
                division = self.existing_divisions[path]
                division_id = division.id

            last_parent_id = division_id
            last_parent_path = path
            last_parent_name = name

    def _has_next_level(self, record, current_level):
        """Check if there's a non-empty level after current_level."""
        try:
            idx = self.GEO_LEVELS.index(current_level)
            for next_level in self.GEO_LEVELS[idx + 1:]:
                if record.get(next_level):
                    return True
        except (ValueError, IndexError):
            pass
        return False

    def _insert_division(self, name, parent_id, has_children, gadm_uid=None, geom=None):
        """Insert an administrative division and return its ID."""
        if geom and self.include_geometry:
            self.pg_cursor.execute("""
                INSERT INTO administrative_divisions (name, parent_id, has_children, gadm_uid, geom)
                VALUES (%s, %s, %s, %s, validate_multipolygon(ST_GeomFromWKB(%s, 4326)))
                RETURNING id
            """, (name, parent_id, has_children, gadm_uid, geom))
        else:
            self.pg_cursor.execute("""
                INSERT INTO administrative_divisions (name, parent_id, has_children, gadm_uid)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (name, parent_id, has_children, gadm_uid))

        return self.pg_cursor.fetchone()[0]

    def _batch_compute_derived_columns(self):
        """Batch-compute all derived geometry columns after bulk import.

        Runs as a single pass over all divisions with geometry, computing:
        1. geom_simplified_low/medium (4326 simplification)
        2. geom_3857 (transform to Web Mercator)
        3. geom_simplified_low_3857/medium_3857 (3857 simplification)

        Much faster than per-row trigger execution during INSERT.
        """
        # Count divisions needing computation
        self.pg_cursor.execute("""
            SELECT COUNT(*) FROM administrative_divisions
            WHERE geom IS NOT NULL AND geom_3857 IS NULL
        """)
        count = self.pg_cursor.fetchone()[0]
        if count == 0:
            print("  All derived columns already computed.")
            return

        print(f"\n  Computing derived geometry columns for {count:,} divisions...")
        start = time.perf_counter()

        # Step 1: 4326 simplification (same as trigger_simplify_geom)
        print("    Step 1/3: Simplifying geometries (4326)...", end=" ", flush=True)
        self.pg_cursor.execute("""
            UPDATE administrative_divisions
            SET geom_simplified_low = validate_multipolygon(
                    ST_SimplifyPreserveTopology(geom, 0.1)),
                geom_simplified_medium = validate_multipolygon(
                    ST_SimplifyPreserveTopology(geom, 0.01)),
                updated_at = NOW()
            WHERE geom IS NOT NULL AND geom_simplified_low IS NULL
        """)
        self.pg_conn.commit()
        print(f"done ({time.perf_counter() - start:.1f}s)")

        # Step 2: Transform to 3857 (with polar clipping fallback)
        step2_start = time.perf_counter()
        print("    Step 2/3: Transforming to Web Mercator (3857)...", end=" ", flush=True)
        self.pg_cursor.execute("""
            UPDATE administrative_divisions
            SET geom_3857 = validate_multipolygon(
                ST_Transform(
                    CASE
                        WHEN ST_YMin(geom) < -85.06 OR ST_YMax(geom) > 85.06
                        THEN ST_Intersection(geom, ST_MakeEnvelope(-180, -85.06, 180, 85.06, 4326))
                        ELSE geom
                    END,
                    3857
                )
            )
            WHERE geom IS NOT NULL AND geom_3857 IS NULL
        """)
        self.pg_conn.commit()
        print(f"done ({time.perf_counter() - step2_start:.1f}s)")

        # Step 3: 3857 simplification
        step3_start = time.perf_counter()
        print("    Step 3/3: Simplifying geometries (3857)...", end=" ", flush=True)
        self.pg_cursor.execute("""
            UPDATE administrative_divisions
            SET geom_simplified_low_3857 = simplify_for_zoom(geom_3857, 5000, 0, 0),
                geom_simplified_medium_3857 = simplify_for_zoom(geom_3857, 1000, 0, 0)
            WHERE geom_3857 IS NOT NULL AND geom_simplified_low_3857 IS NULL
        """)
        self.pg_conn.commit()
        print(f"done ({time.perf_counter() - step3_start:.1f}s)")

        elapsed = time.perf_counter() - start
        print(f"  Derived columns complete for {count:,} divisions ({elapsed:.1f}s)")

    def merge_single_children(self):
        """
        Merge single children that have the same name as their parent.

        This handles cases like:
          Germany -> Berlin -> Berlin -> Berlin

        After merging:
          Germany -> Berlin

        The redundant intermediate "Berlin" nodes are removed.
        """
        if not self.postprocess:
            return

        print("\nMerging redundant single children...")
        progress = ProgressTracker(len(self.single_children), "single children")
        merged_count = 0

        # Collect updates and deletes for batching
        updates = []  # (new_parent_id, child_id)
        deletes = []  # (old_parent_id,)

        for single_child in self.single_children:
            progress.update()

            # Only merge if child has same name as parent
            if single_child.name == single_child.parent_name:
                old_parent = self.existing_divisions.get(single_child.parent_path)
                if not old_parent:
                    continue

                # Find the new parent (grandparent)
                new_parent = self.existing_divisions.get(old_parent.parent_path) if old_parent.parent_path else None

                updates.append((new_parent.id if new_parent else None, single_child.id))
                deletes.append((old_parent.id,))

                # Update tracking
                single_child.parent_id = new_parent.id if new_parent else None
                single_child.parent_path = new_parent.path if new_parent else None
                if old_parent.path in self.existing_divisions:
                    del self.existing_divisions[old_parent.path]

                merged_count += 1

        # Execute batched updates
        if updates:
            execute_batch(
                self.pg_cursor,
                "UPDATE administrative_divisions SET parent_id = %s WHERE id = %s",
                updates,
                page_size=1000
            )

        # Execute batched deletes
        if deletes:
            execute_batch(
                self.pg_cursor,
                "DELETE FROM administrative_divisions WHERE id = %s",
                deletes,
                page_size=1000
            )

        progress.finish()
        print(f"  Merged {merged_count} redundant divisions")


def create_sample_views(cursor):
    """Create some sample views for testing."""
    print("\nCreating sample views...")

    cursor.execute("""
        INSERT INTO views (name, description) VALUES
            ('My Visited Places', 'Administrative divisions I have visited'),
            ('Bucket List', 'Places I want to visit')
        ON CONFLICT DO NOTHING;
    """)
    print("  Created 2 sample views.")


def print_stats(cursor):
    """Print database statistics."""
    print("\n" + "="*50)
    print("Database Statistics:")
    print("="*50)

    cursor.execute("SELECT COUNT(*) FROM administrative_divisions")
    total = cursor.fetchone()[0]
    print(f"  Total administrative divisions: {total:,}")

    cursor.execute("SELECT COUNT(*) FROM administrative_divisions WHERE parent_id IS NULL")
    roots = cursor.fetchone()[0]
    print(f"  Root divisions (continents): {roots:,}")

    cursor.execute("SELECT COUNT(*) FROM administrative_divisions WHERE geom IS NOT NULL")
    with_geom = cursor.fetchone()[0]
    print(f"  Divisions with geometry: {with_geom:,}")

    cursor.execute("SELECT COUNT(*) FROM views")
    views = cursor.fetchone()[0]
    print(f"  Views: {views:,}")

    print("="*50)


def main():
    parser = argparse.ArgumentParser(
        description="Load GADM administrative divisions into database"
    )
    parser.add_argument(
        "-s", "--source",
        required=True,
        help="Path to the GADM GeoPackage file"
    )
    parser.add_argument(
        "-g", "--geometry",
        action="store_true",
        help="Include geometry data (requires GDAL)"
    )
    parser.add_argument(
        "-f", "--fast",
        action="store_true",
        help="Fast mode - skip postprocessing optimizations"
    )
    args = parser.parse_args()

    if not os.path.exists(args.source):
        print(f"Error: Source file not found: {args.source}")
        sys.exit(1)

    db_name, db_user, db_password, db_host = get_db_credentials()

    with DatabaseConnectionManager(db_host, db_name, db_user, db_password, args.source) as (pg_conn, pg_cur, sqlite_cur):

        processor = GADMProcessor(
            pg_cursor=pg_cur,
            sqlite_cursor=sqlite_cur,
            pg_conn=pg_conn,
            gadm_file=args.source,
            include_geometry=args.geometry,
            postprocess=not args.fast
        )

        if args.geometry:
            processor.load_geometries_into_memory()

        processor.process_records()

        # Merge redundant single children (Berlin -> Berlin -> Berlin)
        processor.merge_single_children()

        create_sample_views(pg_cur)

        print_stats(pg_cur)

    print("\nGADM data import complete!")


if __name__ == "__main__":
    main()
