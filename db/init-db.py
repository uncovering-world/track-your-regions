#!/usr/bin/env python3
"""
Initialize the new-gen database from GADM GeoPackage file.

This script loads GADM administrative divisions into the database.
It creates the administrative_divisions table with pre-simplified geometries
for different zoom levels.

Usage:
    # With Docker (schema already created by 01-schema.sql):
    python init-db.py -s /path/to/gadm_410.gpkg -g --skip-schema

    # Standalone (creates schema):
    python init-db.py -s /path/to/gadm_410.gpkg -g
"""

import argparse
import math
import os
import sqlite3
import sys
import time
from datetime import timedelta

import psycopg2
from psycopg2.extras import execute_values, execute_batch
from dotenv import load_dotenv

try:
    from osgeo import ogr
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

        return self.cur_pg, self.cur_sqlite

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
        self.last_print_time = self.start_time
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


def create_schema(cursor):
    """Create the database schema with PostGIS extensions.

    Note: When using Docker, the schema is created by 01-schema.sql automatically.
    Use --skip-schema flag in that case. This function is for standalone use.
    """
    print("\nCreating database schema...")

    # Enable PostGIS
    print("  Enabling PostGIS extension...", end=" ")
    cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    print("done.")

    # Enable pg_trgm for similarity search
    print("  Enabling pg_trgm extension...", end=" ")
    cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    print("done.")

    # Drop existing tables for clean start
    print("  Dropping existing tables...", end=" ")
    cursor.execute("""
        DROP TABLE IF EXISTS view_division_mapping CASCADE;
        DROP TABLE IF EXISTS views CASCADE;
        DROP TABLE IF EXISTS administrative_divisions CASCADE;
    """)
    print("done.")

    # Create administrative_divisions table with simplified geometry columns
    print("  Creating administrative_divisions table...", end=" ")
    cursor.execute("""
        CREATE TABLE administrative_divisions (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            parent_id INTEGER REFERENCES administrative_divisions(id) ON DELETE SET NULL,
            has_children BOOLEAN NOT NULL DEFAULT false,
            gadm_uid INTEGER,
            geom GEOMETRY(MultiPolygon, 4326),
            geom_simplified_low GEOMETRY(MultiPolygon, 4326),
            geom_simplified_medium GEOMETRY(MultiPolygon, 4326),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    print("done.")

    # Create views table
    print("  Creating views table...", end=" ")
    cursor.execute("""
        CREATE TABLE views (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    print("done.")

    # Create view_division_mapping table
    print("  Creating view_division_mapping table...", end=" ")
    cursor.execute("""
        CREATE TABLE view_division_mapping (
            id SERIAL PRIMARY KEY,
            view_id INTEGER NOT NULL REFERENCES views(id) ON DELETE CASCADE,
            division_id INTEGER NOT NULL REFERENCES administrative_divisions(id) ON DELETE CASCADE,
            UNIQUE(view_id, division_id)
        );
    """)
    print("done.")

    # Create indexes
    print("  Creating indexes...", end=" ")
    cursor.execute("""
        CREATE INDEX idx_admin_divisions_parent ON administrative_divisions(parent_id);
        CREATE INDEX idx_admin_divisions_name ON administrative_divisions(name);
        CREATE INDEX idx_admin_divisions_name_trgm ON administrative_divisions USING GIN(name gin_trgm_ops);
        CREATE INDEX idx_admin_divisions_geom ON administrative_divisions USING GIST(geom);
        CREATE INDEX idx_admin_divisions_geom_low ON administrative_divisions USING GIST(geom_simplified_low);
        CREATE INDEX idx_admin_divisions_geom_medium ON administrative_divisions USING GIST(geom_simplified_medium);
        CREATE INDEX idx_view_mapping_view ON view_division_mapping(view_id);
        CREATE INDEX idx_view_mapping_division ON view_division_mapping(division_id);
    """)
    print("done.")

    # Create function to update simplified geometries
    print("  Creating geometry simplification trigger...", end=" ")
    cursor.execute("""
        CREATE OR REPLACE FUNCTION update_simplified_geometries()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.geom IS NOT NULL THEN
                -- Low detail: ~0.1 degree tolerance (good for world view)
                NEW.geom_simplified_low := ST_SimplifyPreserveTopology(NEW.geom, 0.1);
                -- Medium detail: ~0.01 degree tolerance (good for country view)
                NEW.geom_simplified_medium := ST_SimplifyPreserveTopology(NEW.geom, 0.01);
            END IF;
            NEW.updated_at := NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trigger_simplify_geom ON administrative_divisions;
        CREATE TRIGGER trigger_simplify_geom
            BEFORE INSERT OR UPDATE OF geom ON administrative_divisions
            FOR EACH ROW
            EXECUTE FUNCTION update_simplified_geometries();
    """)
    print("done.")

    print("Schema creation complete.")


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

    def __init__(self, pg_cursor, sqlite_cursor, gadm_file, include_geometry=True, postprocess=True):
        self.pg_cursor = pg_cursor
        self.sqlite_cursor = sqlite_cursor
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
        """Process all GADM records and insert into database."""
        print("\nProcessing GADM records...")

        cols = ", ".join(self.PROPERTIES)
        self.sqlite_cursor.execute(f'SELECT {cols} FROM "{self.table_name}"')

        progress = ProgressTracker(self.record_count, "records")

        for row in self.sqlite_cursor:
            self._process_row(dict(zip(self.PROPERTIES, row)))
            progress.update()

        progress.finish()

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
                            geom = CASE WHEN %s IS NULL THEN geom ELSE ST_Multi(ST_GeomFromWKB(%s, 4326)) END,
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
                VALUES (%s, %s, %s, %s, ST_Multi(ST_GeomFromWKB(%s, 4326)))
                RETURNING id
            """, (name, parent_id, has_children, gadm_uid, geom))
        else:
            self.pg_cursor.execute("""
                INSERT INTO administrative_divisions (name, parent_id, has_children, gadm_uid)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (name, parent_id, has_children, gadm_uid))

        return self.pg_cursor.fetchone()[0]

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
    parser.add_argument(
        "--skip-schema",
        action="store_true",
        help="Skip schema creation (use existing tables)"
    )
    args = parser.parse_args()

    if not os.path.exists(args.source):
        print(f"Error: Source file not found: {args.source}")
        sys.exit(1)

    db_name, db_user, db_password, db_host = get_db_credentials()

    with DatabaseConnectionManager(db_host, db_name, db_user, db_password, args.source) as (pg_cur, sqlite_cur):

        if not args.skip_schema:
            create_schema(pg_cur)

        processor = GADMProcessor(
            pg_cursor=pg_cur,
            sqlite_cursor=sqlite_cur,
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
