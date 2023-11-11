import argparse
import math
import os
import sqlite3
import sys
from datetime import datetime

import psycopg2
from dotenv import load_dotenv
from osgeo import ogr


class DatabaseConnectionManager:
    def __init__(self, db_host, db_name, db_user, db_password, gadm_file):
        self.db_host = db_host
        self.db_name = db_name
        self.db_user = db_user
        self.db_password = db_password
        self.gadm_file = gadm_file

    def __enter__(self):
        print(f"Connecting to the database {self.db_name} as {self.db_user}...", end=" ")
        try:
            self.conn_pg = psycopg2.connect(f"dbname={self.db_name} user={self.db_user} password={self.db_password}")
            self.cur_pg = self.conn_pg.cursor()
        except psycopg2.OperationalError as e:
            print(f"Error: Could not connect to the database {self.db_name} as {self.db_user}: {e}")
            sys.exit(1)
        print("done.")
        print(f"Opening {self.gadm_file} as a SQLite database...", end=" ")
        try:
            self.conn_sqlite = sqlite3.connect(self.gadm_file)
            self.cur_sqlite = self.conn_sqlite.cursor()
        except sqlite3.OperationalError as e:
            print(f"Error: Could not open {self.gadm_file} as a SQLite database: {e}")
            sys.exit(1)
        print("done.")
        return self.cur_pg, self.cur_sqlite

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.conn_pg.commit()
        self.cur_pg.close()
        self.conn_pg.close()
        self.cur_sqlite.close()
        self.conn_sqlite.close()


class Timestamp:
    def __init__(self, total_items, items_name="items"):
        self.loop_start_time = datetime.now()
        self.iteration_timestamp = self.loop_start_time
        self.items_name = items_name
        self.total_items = total_items
        self.items_in_one_percent = math.ceil(float(total_items) / 100)
        self.iteration = 0

    def print(self):
        self.iteration += 1
        if self.iteration % self.items_in_one_percent != 0:
            return
        # Print a progress message every 1% of features and timestamp, how long it took
        time_now = datetime.now()
        iteration_time_diff = (time_now - self.iteration_timestamp).total_seconds()
        loop_time_diff = (time_now - self.loop_start_time).total_seconds()
        estimated_time_left = (loop_time_diff / (float(self.iteration) / self.total_items)) - loop_time_diff
        # Get the milliseconds part of the estimated time left
        ms_part = estimated_time_left - int(estimated_time_left)
        ms = f"{ms_part:.3f}".split(".")[1]
        estimated_time_left_human = datetime.fromtimestamp(estimated_time_left).strftime("%H:%M:%S")
        max_digits = len(str(self.total_items))
        print(
            f"Handled {int(self.iteration / self.items_in_one_percent):3d}% ({self.iteration:{max_digits}}/{self.total_items} {self.items_name}) - last batch in {iteration_time_diff:.2f} seconds. Estimated time left: {estimated_time_left_human}.{ms}")
        self.iteration_timestamp = time_now

    def print_total(self):
        time_now = datetime.now()
        loop_time_diff = (time_now - self.loop_start_time).total_seconds()
        loop_time_human = datetime.fromtimestamp(loop_time_diff).strftime("%H:%M:%S")
        print(f"Handled {self.total_items} {self.items_name} in {loop_time_human}.")


def parse_args():
    parser = argparse.ArgumentParser(description="Script to initialize the administartive divisions table in the database.")
    parser.add_argument('gadm_file', help='Path to the GADM GeoPackage file.')
    parser.add_argument('-g', '--geometry', action='store_true', help='Adds the geometry to the administartive divisions table.')
    parser.add_argument('-f', '--fast', action='store_true', help='Fast mode - does not do postprocessing.')
    return parser.parse_args()


# Read the DB credentials from .env files.
# The order of the files is important, as the variables are overwritten in the
# order they are loaded.
def get_db_credentials_from_env():
    env_files = [".env", ".env.development", ".env.production", ".env.local"]
    for env_file in env_files:
        if os.path.exists(env_file):
            print(f"Loading environment variables from {env_file}")
            load_dotenv(env_file)

    db_name = os.getenv("DB_NAME")
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")
    # Optional DB_HOST variable, defaults to localhost
    db_host = os.getenv("DB_HOST", "localhost")

    # Check that the DB credentials were provided
    if db_name is None or db_user is None or db_password is None:
        print("Error: DB_NAME, DB_USER, and DB_PASSWORD must be provided in .env")
        sys.exit(1)

    return db_name, db_user, db_password, db_host


class GADMRecord:
    def __init__(self, processor, properties, row):
        self.processor = processor # Reference to the GADMRecordsProcessor instance
        self._record = dict(zip(properties, row))
        # Dictionary to store the subcountry level and name for the current record
        self._subcountry_level = None
        self.path_parts = []  # List to build up the path for the current region
        self.last_valid_parent_id = None
        self.last_valid_parent_path = None
        self.last_valid_parent_name = None

    def __getitem__(self, item):
        return self._record.get(item)

    @property
    def subcountry_level(self):
        return self._subcountry_level

    @subcountry_level.setter
    def subcountry_level(self, value):
        self._subcountry_level = value


    def next_non_empty_level(self, current_level):
        idx = self.processor.property_index(current_level)
        for next_idx in range(idx + 1, len(self.processor.geo_levels)):
            next_level_name = self.processor.geo_levels[next_idx]
            if self._record[next_level_name]:
                return next_level_name
        return None

class AdmDivision:
    def __init__(self, record, division_type, name):
        self.record = record # Reference to the GADMRecord instance to which the division belongs
        self.type = division_type
        self.name = name
        self.path = None
        self.id = None
        self.children_num = 0
        self.parent_id = None
        self.single_child = None

    def update_path(self):
        self.path = "_".join(self.record.path_parts)


class GADMRecordsProcessor:
    def __init__(self, src_cursor, dst_cursor, src_file, args):
        self.src_cursor = src_cursor
        self.src_file = src_file
        self.dst_cursor = dst_cursor
        self.subcountry_levels = ['SOVEREIGN', 'GOVERNEDBY']
        self.geo_levels = ['CONTINENT', 'SUBCONT'] + self.subcountry_levels + ['COUNTRY', 'REGION'] + [f'NAME_{i}' for i in range(6)]
        self.properties = self.geo_levels + ['UID', 'geom']
        self.handle_geometry = args.geometry
        self.postprocess = not args.fast
        self.src_table_name = self._get_gadm_table_name()
        self.geometries = {}
        self.divisions = {}
        self.single_children = []
        self.records_num = self._records_num()

    def _records_num(self):
        print(f"Counting records in the {self.src_table_name} table...", end=" ", flush=True)
        try:
            self.src_cursor.execute(f"SELECT COUNT(*) FROM {self.src_table_name}")
        except sqlite3.OperationalError as e:
            print(f"Error: Could not read the GeoPackage file: {e}")
            sys.exit(1)
        print("done.")
        return self.src_cursor.fetchone()[0]

    def property_index(self, property_name):
        return self.properties.index(property_name)

    def create_dst_table(self):
        try:
            self.dst_cursor.execute("""
                CREATE TABLE IF NOT EXISTS adm_divisions (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        parent_id INTEGER REFERENCES adm_divisions(id),
                        has_children BOOLEAN NOT NULL,
                        gadm_uid INTEGER,
                        geom GEOMETRY(MULTIPOLYGON, 4326)
                    )
                """)
        except psycopg2.OperationalError as e:
            print(f"Error: Could not create the adm_divisions table: {e}")
            sys.exit(1)

    # Get the name of the GADM table from the GeoPackage.
    # It will also be used as the name of the layer when the GeoPackage is opened with GDAL (to read geometries).
    def _get_gadm_table_name(self):
        try:
            self.src_cursor.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table'
                AND name NOT LIKE 'sqlite_%' 
                AND name NOT LIKE 'rtree_%'
                AND name NOT LIKE 'idx_%'
                AND name NOT LIKE 'gidx_%'
                AND name NOT LIKE 'gpkg_%'
            """)
        except sqlite3.OperationalError as e:
            print(f"Error: Could not read the GeoPackage file: {e}")
            sys.exit(1)
        layers = [row[0] for row in self.src_cursor.fetchall()]
        if not layers:
            print("Error: No layers found in the GeoPackage file")
            sys.exit(1)
        if len(layers) > 1:
            print(f"Warning: Expected only one layer in GeoPackage, found {len(layers)}. Using first layer.")
        return layers[0]

    def copy_geometry_into_memory(self):
        if not self.handle_geometry:
            return
        ds = ogr.Open(self.src_file)
        layer = ds.GetLayerByName(self.src_table_name)
        timestamp = Timestamp(layer.GetFeatureCount(), "geometries copied into memory")
        for feature in layer:
            timestamp.print()
            gadm_uid = feature.GetField("UID")
            geometry = feature.GetGeometryRef().ExportToWkb()
            self.geometries[gadm_uid] = geometry
        timestamp.print_total()

    def init_adm_divisions_table(self):
        self.src_cursor.execute(f"SELECT {', '.join(self.properties)} FROM {self.src_table_name}")
        timestamp = Timestamp(self.records_num, "GADM records")
        for row in self.src_cursor:
            timestamp.print()
            self.handle_row(row)
        timestamp.print_total()

    def handle_row(self, row):
        record = GADMRecord(self, self.properties, row)

        # Identify the subcountry level for the current record
        for level in self.subcountry_levels:
            if record[level]:
                record.subcountry_level = level
                break

        # Process each geographical level for the current record
        for level in self.geo_levels:
            division = AdmDivision(record, level, record[level])

            # Skip empty levels
            if not division.name:
                continue

            # Skip unnecessary subcountry level
            if division.type in self.subcountry_levels:
                # Skip non-prioritized country levels
                if division.type != record.subcountry_level:
                    continue
                # It's the prioritized subcountry level, so we need to check if it's the same as the country level
                elif division.name == record['COUNTRY']:
                    continue

            # Skip the NAME_0 level if it's the same as the country level
            # Sometimes the NAME_0 represents country, sometimes it represents a division within a country
            if division.type == 'NAME_0' and division.name == record['COUNTRY']:
                # We can skip it only if the next level is not empty
                if record.next_non_empty_level(division.type):
                    continue
                # if the next level is empty, we need to update the parent division with the current division info
                uid = record['UID']
                geom = None if not self.handle_geometry else self.geometries[uid]
                self.dst_cursor.execute("""
                    UPDATE adm_divisions
                    SET gadm_uid = %s, geom = ST_GeomFromWKB(%s, 4326), has_children = FALSE
                    WHERE id = %s
                """, (uid, geom, record.last_valid_parent_id))
                continue

            # We have skipped all the unnecessary levels, so we can form a unique key for the current division
            record.path_parts.append(division.name)  # Add the name to the path_parts list if it's not empty
            division.update_path()  # Build the unique key from the path_parts list

            # Determine if the current division has subregions
            next_level = record.next_non_empty_level(division.type)
            has_children = next_level is not None  # Check if a non-empty level was found

            # We assign uid to the division, if it's the last level, and it has no subdivisions,
            # as only such divisions have a unique uid in GADM.
            if has_children:
                uid = None
                geom = None
            else:
                uid = record['UID']
                geom = None if not self.handle_geometry else self.geometries[uid]

            if division.path not in self.divisions:
                query = """
                    INSERT INTO adm_divisions (name, has_children, parent_id, gadm_uid, geom)
                    VALUES (%s, %s, %s, %s, ST_GeomFromWKB(%s, 4326))
                    RETURNING id
                """
                params = (division.name, has_children, record.last_valid_parent_id, uid, geom)
                self.dst_cursor.execute(query, params)
                division.id = self.dst_cursor.fetchone()[0]
                self.divisions[division.path] = division

                # If not in fast mode, append the information that tracks single children and
                # helps to merge them with their parents later during the postprocessing
                if not args.fast:
                    division.parent_id = record.last_valid_parent_id
                    division.parent_path = record.last_valid_parent_path
                    division.parent_name = record.last_valid_parent_name
                    # If the division has a parent, update the parent's children_num and single_child
                    # It is necessary to detect single children and merge them with their parents later
                    if record.last_valid_parent_path:
                        parent = self.divisions[record.last_valid_parent_path]
                        parent.children_num += 1
                        if parent.children_num == 1:
                            # Mark as potentially single child, as it's the first child found for the parent
                            self.single_children.append(division)
                            # Save the potential single child ID to the parent division
                            parent.single_child = division
                        elif parent.children_num == 2:
                            # The second child was found, so remove the sibling from the list of single children
                            sibling = parent.single_child
                            # Remove the sibling from the list of single children
                            self.single_children.remove(sibling)
                            parent.single_child = None
            else:
                # If the division already exists, get its ID
                division = self.divisions[division.path]

            # Update the parent division info for the next iteration
            record.last_valid_parent_id = division.id
            record.last_valid_parent_name = division.name
            record.last_valid_parent_path = division.path

    def merge_single_children(self):
        timestamp = Timestamp(len(self.single_children), "single children")
        for single_child in self.single_children:
            timestamp.print()
            # Merge the single child with its parent only if they have the same name
            if single_child.name == single_child.parent_name:
                old_parent = self.divisions[single_child.parent_path]
                new_parent = self.divisions.get(old_parent.parent_path)
                # Remove the parent division and update the single child's parent ID
                # Update the single child's parent ID
                self.dst_cursor.execute("UPDATE adm_divisions SET parent_id = %s WHERE id = %s",
                                        (new_parent.id if new_parent else None, single_child.id))
                # Do not forget to update the single child's parent ID in the dictionary
                single_child.parent_id = new_parent.id if new_parent else None
                single_child.parent_path = new_parent.path if new_parent else None
                # Delete the parent
                cur_dst.execute("DELETE FROM adm_divisions WHERE id = %s", (old_parent.id,))
                del self.divisions[old_parent.path]
        timestamp.print_total()


if __name__ == "__main__":

    args = parse_args()

    gadm_file = args.gadm_file

    # Check that the GeoPackage file exists
    if not os.path.exists(gadm_file):
        print(f"Error: GeoPackage file {gadm_file} does not exist")
        sys.exit(1)

    # Read the DB credentials from .env files.
    db_name, db_user, db_password, db_host = get_db_credentials_from_env()

    with DatabaseConnectionManager(db_host, db_name, db_user, db_password, gadm_file) as (cur_dst, cur_src):

        records_processor = GADMRecordsProcessor(cur_src, cur_dst, gadm_file, args)

        # Create the Region table, if it doesn't exist
        records_processor.create_dst_table()

        global_timestamp_start = datetime.now()

        if args.geometry:
            print("Copying geometries into memory:")
            records_processor.copy_geometry_into_memory()
            print("Geometry copying complete.")

        print(f"Processing {records_processor.records_num} GADM records", end="")
        if args.geometry:
            print(" with geometries", end="")
        if args.fast:
            print(" without postprocessing", end="")
        print(":")

        print("Initializing the adm_divisions table...")
        records_processor.init_adm_divisions_table()
        print("adm_divisions table initialization complete.")

        # Create indexes for id
        print("Creating index for the id field...", end=" ", flush=True)
        cur_dst.execute("CREATE INDEX IF NOT EXISTS idx_id ON adm_divisions (id)")
        print("done.")

        if not args.fast:
            # Merge single children with their parents
            print("Merging single children with their parents...")
            records_processor.merge_single_children()
            print("Single children merging complete.")

        # Create indexes on the adm_divisions table
        print("Creating index for the parent_id field...", end=" ", flush=True)
        cur_dst.execute("CREATE INDEX IF NOT EXISTS idx_parent_id ON adm_divisions (parent_id)")
        print("done.")
        # Create a GiST index on the geometry column
        if args.geometry:
            print("Creating geometry index...", end=" ", flush=True)
            cur_dst.execute("CREATE INDEX IF NOT EXISTS idx_geom ON regions USING GIST (geom)")
            print("done.")
        print(f"DB init complete in {datetime.now() - global_timestamp_start} !")

