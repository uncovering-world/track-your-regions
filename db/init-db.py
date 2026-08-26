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
import re
import sqlite3
import sys
import time
from datetime import timedelta

import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

# Which levels of a GADM row are divisions, what each is called and what
# identifies it, is decided in gadm_levels.py -- one row in, a list of divisions
# out (#665). PROPERTIES is the set of columns that decision reads, so the
# SELECT below asks the GeoPackage for exactly them.
from gadm_levels import PROPERTIES, REMAINDER_SUFFIX, row_divisions

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
    def __init__(self, name, division_id, parent_id, parent_path, parent_name, path,
                 name_borrowed=False):
        self.name = name
        self.id = division_id
        self.parent_id = parent_id
        self.parent_path = parent_path
        self.parent_name = parent_name
        self.path = path
        self.children_num = 0
        self.single_child = None
        # True where GADM named nothing and the name above came from the parent.
        # `merge_single_children` hands it down: a division that absorbs its
        # parent takes that parent's name, and whether *that* was borrowed is
        # what decides if the result still needs labelling (#665).
        self.name_borrowed = name_borrowed


class GADMProcessor:
    """Processes GADM GeoPackage file and loads data into PostgreSQL."""

    # Commit every N records during bulk import to limit transaction size
    COMMIT_INTERVAL = 10000

    # A GeoPackage layer name is chosen by whoever produced the file, and it is
    # interpolated into SQL as an identifier. Accept only plain identifiers.
    TABLE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

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
        # Divisions GADM did not name: they carry their parent's name, and the
        # ones that survive merge_single_children are relabelled (#665)
        self.unnamed_divisions = []
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
        table_name = layers[0]
        # The layer name reaches SQL as an identifier, and identifiers cannot be
        # bound as parameters. Everything downstream that interpolates
        # self.table_name relies on this check, so a GeoPackage carrying a
        # crafted layer name is rejected here rather than quoted there.
        if not self.TABLE_NAME_RE.match(table_name):
            print(f"Error: GeoPackage layer name is not a plain identifier: {table_name!r}")
            sys.exit(1)
        return table_name

    def _count_records(self):
        """Count total records in GADM file."""
        # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query,python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- sqlite3, not SQLAlchemy; table_name is an identifier (unbindable) validated against TABLE_NAME_RE in _get_gadm_table_name
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
        #   trigger_division_focus_data: a snap and a longitude shift over every vertex
        # These results get overwritten by precalculate-geometries.py anyway,
        # except the focus data, which step 4 below computes in one pass.
        if self.include_geometry:
            print("  Disabling geometry triggers for bulk import...")
            self.pg_cursor.execute("""
                ALTER TABLE administrative_divisions DISABLE TRIGGER trigger_simplify_geom;
                ALTER TABLE administrative_divisions DISABLE TRIGGER trg_admin_div_geom_3857;
                ALTER TABLE administrative_divisions DISABLE TRIGGER trigger_division_focus_data;
            """)
            self.pg_conn.commit()

        cols = ", ".join(PROPERTIES)
        # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query,python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- sqlite3, not SQLAlchemy; cols is the PROPERTIES module constant and table_name is validated against TABLE_NAME_RE in _get_gadm_table_name
        self.sqlite_cursor.execute(f'SELECT {cols} FROM "{self.table_name}"')

        progress = ProgressTracker(self.record_count, "records")

        for row in self.sqlite_cursor:
            self._process_row(dict(zip(PROPERTIES, row)))
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
                ALTER TABLE administrative_divisions ENABLE TRIGGER trigger_division_focus_data;
            """)
            self.pg_conn.commit()

    def _process_row(self, record):
        """Insert the divisions one GADM record names, and hang its polygon on the leaf.

        The record decides nothing here -- `row_divisions` reads it and hands
        back the divisions it names, outermost first, each already placed under
        the one above it, with the last carrying this row's polygon (#665). What
        is left is the bookkeeping: get or create each of them, and remember
        enough of the tree for `merge_single_children` to collapse a redundant
        pair afterwards.
        """
        uid = record.get("UID")
        geom = self.geometries.get(uid) if self.include_geometry else None

        for row_division in row_divisions(record):
            division = self.existing_divisions.get(row_division.path)
            if division is not None:
                if row_division.is_leaf and geom:
                    self._attach_own_geometry(division.id, uid, geom)
                continue

            parent = self.existing_divisions.get(row_division.parent_path) if row_division.parent_path else None
            division_id = self._insert_division(
                name=row_division.name,
                parent_id=parent.id if parent else None,
                has_children=not row_division.is_leaf,
                gadm_uid=uid if row_division.is_leaf else None,
                geom=geom if row_division.is_leaf else None,
            )

            division = Division(
                name=row_division.name,
                division_id=division_id,
                parent_id=parent.id if parent else None,
                parent_path=row_division.parent_path,
                parent_name=parent.name if parent else None,
                path=row_division.path,
                name_borrowed=not row_division.named,
            )
            self.existing_divisions[row_division.path] = division
            self._track_single_child(division, row_division.parent_path)
            if not row_division.named:
                self.unnamed_divisions.append(division)

    def _track_single_child(self, division, parent_path):
        """Remember a division that is, so far, the only child of its parent.

        `merge_single_children` collapses the redundant pair a single child of
        the same name makes — Germany -> Berlin -> Berlin. A parent stops being
        watched the moment a second child arrives.
        """
        if not self.postprocess or not parent_path:
            return
        parent_division = self.existing_divisions.get(parent_path)
        if not parent_division:
            return

        parent_division.children_num += 1
        if parent_division.children_num == 1:
            self.single_children.append(division)
            parent_division.single_child = division
        elif parent_division.children_num == 2:
            sibling = parent_division.single_child
            if sibling in self.single_children:
                self.single_children.remove(sibling)
            parent_division.single_child = None

    def _attach_own_geometry(self, division_id, uid, geom):
        """Give a division that already exists the polygon of a row that is its own.

        A country whose record names nothing below it is the case this exists
        for: `COUNTRY` and `NAME_0` are one division, so the row carrying the
        country's own outline arrives after the rows that created it from below.

        Only an empty geometry is filled. Where two records resolve to one
        division the first polygon stays, which is what the loader did before
        this was written down — GADM 4.1 has 95 name paths that carry more than
        one GID, 88 of them in the United Kingdom, and choosing between those
        rows is a defect of its own (#681) rather than a decision to take here.
        """
        self.pg_cursor.execute("""
            UPDATE administrative_divisions
            SET gadm_uid = %s,
                geom = validate_multipolygon(ST_GeomFromWKB(%s, 4326))
            WHERE id = %s AND geom IS NULL
        """, (uid, geom, division_id))

    def label_surviving_remainders(self):
        """Relabel an unnamed division that ends up standing beside its siblings.

        A division GADM did not name carries its parent's name, which is right
        while it is the parent's only row: `merge_single_children` collapses that
        pair and the polygon surfaces under the name it always had. Where the
        parent has other children the pair stays, and the tree then offers the
        same name twice, one inside the other -- and twenty-three Thai districts
        offer it three times, since a *named* tambon of that name stands there
        too.

        So this runs after the merge and asks the tree two questions of each
        candidate: does it still carry the name of the division it sits under,
        and does that division have other children? Both, and the name is a
        borrowed one standing beside real ones, so it is replaced. The rule is
        `remainder_label`'s, spelled in SQL because it runs over every candidate
        at once; both build the name from `REMAINDER_SUFFIX`, so the wording
        cannot drift between the loader and the migration that repairs a
        database already holding these rows.

        What a candidate is cannot be read off the tree, though, and this is where
        the two rows GADM leaves unnamed *twice* decide it. Sharjah and Ras
        Al-Khaimah are those: an unnamed district inside an unnamed emirate-level
        row, so the inner one is the outer one's only child and takes its name,
        the merge deletes the outer and moves the inner up beside the emirate's
        named districts -- still called Sharjah, under Sharjah, and needing the
        label. Russia's 2435 end up in the same *shape* and must be left alone:
        each absorbed a **named** rayon and carries that rayon's name, which is a
        real one, and in 31 of them that name happens to equal the oblast's, so a
        test of "does it match its parent" labels a genuine rayon a remainder.
        What separates them is where the name came from, which only the load
        knows -- so `name_borrowed` is carried on the division and handed down by
        the merge.
        """
        candidates = [
            division.id for division in self.unnamed_divisions if division.name_borrowed
        ]
        if not candidates:
            print("\nNo unnamed divisions to label.")
            return

        print("\nLabelling unnamed divisions that stand beside named siblings...")
        self.pg_cursor.execute("""
            UPDATE administrative_divisions c
               SET name = p.name || %s, updated_at = NOW()
              FROM administrative_divisions p
             WHERE p.id = c.parent_id
               AND c.id = ANY(%s)
               AND c.name = p.name
               AND EXISTS (SELECT 1 FROM administrative_divisions s
                            WHERE s.parent_id = c.parent_id AND s.id <> c.id)
        """, (REMAINDER_SUFFIX, candidates))
        self.pg_conn.commit()
        print(f"  Labelled {self.pg_cursor.rowcount} of {len(candidates)} unnamed divisions")

    def reconcile_has_children(self):
        """Make `has_children` say what the tree says, once every row is in.

        The flag is set when a division is first seen, from the record that
        created it, and no later record revisits it — so a division created by a
        record that named nothing below it stays a leaf however many children
        arrive afterwards. That is one half of #665 (the other half, a polygon
        folded into its parent, `row_divisions` prevents), and it is also what
        `merge_single_children` leaves behind when it reparents a child. Asking
        the tree costs one statement and cannot disagree with it.
        """
        print("\nReconciling has_children with the tree...")
        self.pg_cursor.execute("""
            UPDATE administrative_divisions p
            SET has_children = child.exists, updated_at = NOW()
            FROM (
                SELECT d.id,
                       EXISTS (SELECT 1 FROM administrative_divisions c
                                WHERE c.parent_id = d.id) AS exists
                  FROM administrative_divisions d
            ) child
            WHERE child.id = p.id AND p.has_children IS DISTINCT FROM child.exists
        """)
        self.pg_conn.commit()
        print(f"  Corrected {self.pg_cursor.rowcount} divisions")

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
        3. geom_simplified_low_3857/medium_3857 and the two cheap rungs,
           geom_overview_3857 and geom_simplified_coarse_3857 (3857 simplification)

        Much faster than per-row trigger execution during INSERT.
        """
        # Count divisions needing computation. Any rung missing counts, not just
        # geom_3857: a rung that arrived after the rows did is missing while
        # geom_3857 is not, and a run interrupted between step 2's commit and
        # step 3's leaves geom_3857 filled and every 3857 rung NULL. Asking only
        # about the first of them returns "already computed" in both cases and
        # says so untruthfully, while every division tile falls through to full
        # resolution at every zoom.
        self.pg_cursor.execute("""
            SELECT COUNT(*) FROM administrative_divisions
            WHERE geom IS NOT NULL
              AND (geom_3857 IS NULL
                   OR geom_simplified_low_3857 IS NULL
                   OR geom_overview_3857 IS NULL
                   OR geom_simplified_coarse_3857 IS NULL)
        """)
        count = self.pg_cursor.fetchone()[0]
        if count == 0:
            print("  All derived columns already computed.")
            return

        print(f"\n  Computing derived geometry columns for {count:,} divisions...")
        start = time.perf_counter()

        # Step 1: 4326 simplification (same as trigger_simplify_geom)
        print("    Step 1/4: Simplifying geometries (4326)...", end=" ", flush=True)
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
        print("    Step 2/4: Transforming to Web Mercator (3857)...", end=" ", flush=True)
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
        print("    Step 3/4: Simplifying geometries (3857)...", end=" ", flush=True)
        self.pg_cursor.execute("""
            UPDATE administrative_divisions
            SET geom_simplified_low_3857 = simplify_for_zoom(geom_3857, 5000, 0, 0),
                geom_simplified_medium_3857 = simplify_for_zoom(geom_3857, 1000, 0, 0)
            WHERE geom_3857 IS NOT NULL AND geom_simplified_low_3857 IS NULL
        """)
        # Separate statement so the cheap rungs read the low rung this step just
        # wrote, matching how the trigger derives them. It cannot be left to the
        # trigger: it is disabled for the bulk import, and the UPDATE above
        # changes neither geom nor geom_simplified_low, so re-enabling it would
        # not fire either. Without this a freshly imported database serves the
        # slow pre-computation path on the default world view.
        self.pg_cursor.execute("""
            UPDATE administrative_divisions
            SET geom_overview_3857 =
                    simplify_for_overview(geom_simplified_low_3857, 50000),
                geom_simplified_coarse_3857 =
                    simplify_for_overview(geom_simplified_low_3857, 10000)
            WHERE geom_simplified_low_3857 IS NOT NULL
              AND (geom_overview_3857 IS NULL OR geom_simplified_coarse_3857 IS NULL)
        """)
        self.pg_conn.commit()
        print(f"done ({time.perf_counter() - step3_start:.1f}s)")

        # Step 4: focus data (same as trigger_division_focus_data). The statement
        # db/migrations/033-division-focus-data.sql runs on a database that
        # already holds GADM; here the trigger is disabled for the bulk insert,
        # so a fresh load computes it the same way, once, with no per-row cost.
        step4_start = time.perf_counter()
        print("    Step 4/4: Measuring focus data...", end=" ", flush=True)
        self.pg_cursor.execute("""
            UPDATE administrative_divisions d
            SET (focus_bbox, anchor_point) = (
              SELECT ARRAY[f.west, f.south, f.east, f.north],
                     ST_SetSRID(ST_MakePoint(f.center_lng, f.center_lat), 4326)
              FROM geometry_focus(d.geom) f
            )
            WHERE d.geom IS NOT NULL AND d.focus_bbox IS NULL
        """)
        self.pg_conn.commit()
        print(f"done ({time.perf_counter() - step4_start:.1f}s)")

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
                # The child now stands for the parent, under the parent's name,
                # so whether that name was borrowed is now the child's answer.
                single_child.name_borrowed = old_parent.name_borrowed

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
        help="Accepted for compatibility; the schema is always applied "
             "externally (Docker init / db/init/01-schema.sql). This script "
             "only loads data, so this flag is a documented no-op."
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

        # After the merge, which is what decides who survived to need a label
        processor.label_surviving_remainders()

        # Last, because merging reparents children and so changes the answer
        processor.reconcile_has_children()

        print_stats(pg_cur)

    print("\nGADM data import complete!")


if __name__ == "__main__":
    main()
