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
        print(
            f"Connecting to the database {self.db_name} as {self.db_user}...", end=" "
        )
        try:
            self.conn_pg = psycopg2.connect(
                f"dbname={self.db_name} user={self.db_user} password={self.db_password}"
            )
            self.cur_pg = self.conn_pg.cursor()
        except psycopg2.OperationalError as e:
            print(
                f"Error: Could not connect to the database {self.db_name} as {self.db_user}: {e}"
            )
            sys.exit(1)
        print("done.")
        if self.gadm_file is None:
            return self.cur_pg, None
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
        if self.gadm_file is None:
            return
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
        estimated_time_left = (
            loop_time_diff / (float(self.iteration) / self.total_items)
        ) - loop_time_diff
        # Get the milliseconds part of the estimated time left
        ms_part = estimated_time_left - int(estimated_time_left)
        ms = f"{ms_part:.3f}".split(".")[1]
        estimated_time_left_human = datetime.fromtimestamp(
            estimated_time_left
        ).strftime("%H:%M:%S")
        max_digits = len(str(self.total_items))
        print(
            f"Handled {int(self.iteration / self.items_in_one_percent):3d}% ({self.iteration:{max_digits}}/{self.total_items} {self.items_name}) - last batch in {iteration_time_diff:.2f} seconds. Estimated time left: {estimated_time_left_human}.{ms}"
        )
        self.iteration_timestamp = time_now

    def print_total(self):
        time_now = datetime.now()
        loop_time_diff = (time_now - self.loop_start_time).total_seconds()
        loop_time_human = datetime.fromtimestamp(loop_time_diff).strftime("%H:%M:%S")
        print(f"Handled {self.total_items} {self.items_name} in {loop_time_human}.")
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
        estimated_time_left = (
            loop_time_diff / (float(self.iteration) / self.total_items)
        ) - loop_time_diff
        # Get the milliseconds part of the estimated time left
        ms_part = estimated_time_left - int(estimated_time_left)
        ms = f"{ms_part:.3f}".split(".")[1]
        estimated_time_left_human = datetime.fromtimestamp(
            estimated_time_left
        ).strftime("%H:%M:%S")
        max_digits = len(str(self.total_items))
        print(
            f"Handled {int(self.iteration / self.items_in_one_percent):3d}% ({self.iteration:{max_digits}}/{self.total_items} {self.items_name}) - last batch in {iteration_time_diff:.2f} seconds. Estimated time left: {estimated_time_left_human}.{ms}"
        )
        self.iteration_timestamp = time_now

    def print_total(self):
        time_now = datetime.now()
        loop_time_diff = (time_now - self.loop_start_time).total_seconds()
        loop_time_human = datetime.fromtimestamp(loop_time_diff).strftime("%H:%M:%S")
        print(f"Handled {self.total_items} {self.items_name} in {loop_time_human}.")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Script to initialize the regions table in the database."
    )
    parser.add_argument("-s", "--source", help="Path to the GADM GeoPackage file.")
    parser.add_argument(
        "-g",
        "--geometry",
        action="store_true",
        help="Adds the geometry to the regions table.",
    )
    parser.add_argument(
        "-f",
        "--fast",
        action="store_true",
        help="Fast mode - does not do postprocessing.",
    )
    parser.add_argument(
        "-o",
        "--hierarchy-only",
        action="store_true",
        help="Generate only the Hierarchy table.",
    )
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
        self.processor = processor  # Reference to the GADMRecordsProcessor instance
        self._record = dict(zip(properties, row))
        # Dictionary to store the subcountry level and name for the current record
        self._subcountry_level = None
        self.region_path_parts = []  # List to build up the path for the current region
        self.last_valid_parent_region_id = None
        self.last_valid_parent_region_path = None
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


class Region:
    def __init__(self, record, region_type, name):
        self.record = (
            record  # Reference to the GADMRecord instance to which the Region belongs
        )
        self.type = region_type
        self.name = name
        self.path = None
        self.id = None
        self.children_num = 0
        self.parent_id = None
        self.single_child = None

    def update_path(self):
        self.path = "_".join(self.record.region_path_parts)


class GADMRecordsProcessor:
    def __init__(self, src_cursor, dst_cursor, src_file, args):
        self.src_cursor = src_cursor
        self.src_file = src_file
        self.dst_cursor = dst_cursor
        self.subcountry_levels = ["SOVEREIGN", "GOVERNEDBY"]
        self.geo_levels = (
            ["CONTINENT", "SUBCONT"]
            + self.subcountry_levels
            + ["COUNTRY", "REGION"]
            + [f"NAME_{i}" for i in range(6)]
        )
        self.properties = self.geo_levels + ["UID", "geom"]
        self.handle_geometry = args.geometry
        self.postprocess = not args.fast
        self.src_table_name = self._get_gadm_table_name() if self.src_file else None
        self.geometries = {}
        self.existing_regions = {}
        self.single_children = []
        self.records_num = self._records_num() if self.src_file else 0

    def _records_num(self):
        print(
            f"Counting records in the {self.src_table_name} table...",
            end=" ",
            flush=True,
        )
        try:
            self.src_cursor.execute(f"SELECT COUNT(*) FROM {self.src_table_name}")
        except sqlite3.OperationalError as e:
            print(f"Error: Could not read the GeoPackage file: {e}")
            sys.exit(1)
        print("done.")
        return self.src_cursor.fetchone()[0]

    def property_index(self, property_name):
        return self.properties.index(property_name)

    def create_regions_table(self):
        try:
            self.dst_cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS regions (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        parent_region_id INTEGER REFERENCES regions(id),
                        has_subregions BOOLEAN NOT NULL,
                        gadm_uid INTEGER,
                        geom GEOMETRY(MULTIPOLYGON, 4326)
                    )
                """
            )
        except psycopg2.OperationalError as e:
            print(f"Error: Could not create the regions table: {e}")
            sys.exit(1)

    # Get the name of the GADM regions table from the GeoPackage.
    # It will also be used as the name of the layer when the GeoPackage is opened with GDAL (to read geometries).
    def _get_gadm_table_name(self):
        try:
            self.src_cursor.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type='table'
                AND name NOT LIKE 'sqlite_%' 
                AND name NOT LIKE 'rtree_%'
                AND name NOT LIKE 'idx_%'
                AND name NOT LIKE 'gidx_%'
                AND name NOT LIKE 'gpkg_%'
            """
            )
        except sqlite3.OperationalError as e:
            print(f"Error: Could not read the GeoPackage file: {e}")
            sys.exit(1)
        layers = [row[0] for row in self.src_cursor.fetchall()]
        if not layers:
            print("Error: No layers found in the GeoPackage file")
            sys.exit(1)
        if len(layers) > 1:
            print(
                f"Warning: Expected only one layer in GeoPackage, found {len(layers)}. Using first layer."
            )
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

    def init_regions_table(self):
        self.src_cursor.execute(
            f"SELECT {', '.join(self.properties)} FROM {self.src_table_name}"
        )
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
            region = Region(record, level, record[level])

            # Skip empty levels
            if not region.name:
                continue

            # Skip unnecessary subcountry level
            if region.type in self.subcountry_levels:
                # Skip non-prioritized country levels
                if region.type != record.subcountry_level:
                    continue
                # It's the prioritized subcountry level, so we need to check if it's the same as the country level
                elif region.name == record["COUNTRY"]:
                    continue

            # Skip the NAME_0 level if it's the same as the country level
            # Sometimes the NAME_0 represents country, sometimes it represents a region within a country
            if region.type == "NAME_0" and region.name == record["COUNTRY"]:
                # We can skip it only if the next level is not empty
                if record.next_non_empty_level(region.type):
                    continue
                # if the next level is empty, we need to update the parent region with the current region info
                uid = record["UID"]
                geom = None if not self.handle_geometry else self.geometries[uid]
                self.dst_cursor.execute(
                    """
                    UPDATE regions
                    SET gadm_uid = %s, geom = ST_GeomFromWKB(%s, 4326), has_subregions = FALSE
                    WHERE id = %s
                """,
                    (uid, geom, record.last_valid_parent_region_id),
                )
                continue

            # We have skipped all the unnecessary levels, so we can form a unique key for the current region
            record.region_path_parts.append(
                region.name
            )  # Add the name to the path_parts list if it's not empty
            region.update_path()  # Build the unique key from the path_parts list

            # Determine if the current region has subregions
            next_level = record.next_non_empty_level(region.type)
            has_subregions = (
                next_level is not None
            )  # Check if a non-empty level was found

            # We assign uid to the region, if it's the last level, and it has no subregions,
            # as only such regions have a unique uid in GADM.
            if has_subregions:
                uid = None
                geom = None
            else:
                uid = record["UID"]
                geom = None if not self.handle_geometry else self.geometries[uid]

            if region.path not in self.existing_regions:
                query = """
                    INSERT INTO regions (name, has_subregions, parent_region_id, gadm_uid, geom)
                    VALUES (%s, %s, %s, %s, ST_GeomFromWKB(%s, 4326))
                    RETURNING id
                """
                params = (
                    region.name,
                    has_subregions,
                    record.last_valid_parent_region_id,
                    uid,
                    geom,
                )
                self.dst_cursor.execute(query, params)
                region.id = self.dst_cursor.fetchone()[0]
                self.existing_regions[region.path] = region

                # If not in fast mode, append the information that tracks single children and
                # helps to merge them with their parents later during the postprocessing
                if not args.fast:
                    region.parent_id = record.last_valid_parent_region_id
                    region.parent_path = record.last_valid_parent_region_path
                    region.parent_name = record.last_valid_parent_name
                    # If the region has a parent, update the parent's children_num and single_child
                    # It is necessary to detect single children and merge them with their parents later
                    if record.last_valid_parent_region_path:
                        parent_region = self.existing_regions[
                            record.last_valid_parent_region_path
                        ]
                        parent_region.children_num += 1
                        if parent_region.children_num == 1:
                            # Mark as potentially single child, as it's the first child found for the parent
                            self.single_children.append(region)
                            # Save the potential single child ID to the parent region
                            parent_region.single_child = region
                        elif parent_region.children_num == 2:
                            # The second child was found, so remove the sibling from the list of single children
                            sibling = parent_region.single_child
                            # Remove the sibling from the list of single children
                            self.single_children.remove(sibling)
                            parent_region.single_child = None
            else:
                # If the region already exists, get its ID
                region = self.existing_regions[region.path]

            # Update the parent region info for the next iteration
            record.last_valid_parent_region_id = region.id
            record.last_valid_parent_name = region.name
            record.last_valid_parent_region_path = region.path

    def merge_single_children(self):
        timestamp = Timestamp(len(self.single_children), "single children")
        for single_child in self.single_children:
            timestamp.print()
            # Merge the single child with its parent only if they have the same name
            if single_child.name == single_child.parent_name:
                old_parent = self.existing_regions[single_child.parent_path]
                new_parent = self.existing_regions.get(old_parent.parent_path)
                # Remove the parent region and update the single child's parent ID
                # First - get the parent region's parent ID
                # Second - update the single child's parent ID
                self.dst_cursor.execute(
                    "UPDATE regions SET parent_region_id = %s WHERE id = %s",
                    (new_parent.id if new_parent else None, single_child.id),
                )
                # Do not forget to update the single child's parent ID in the dictionary
                # But first, save the old parent ID to delete the parent region later
                single_child.parent_id = new_parent.id if new_parent else None
                single_child.parent_path = new_parent.path if new_parent else None
                # Third - delete the parent region
                cur_dst.execute("DELETE FROM regions WHERE id = %s", (old_parent.id,))
                del self.existing_regions[old_parent.path]
        timestamp.print_total()

    def create_hierarchy_tables(self):
        try:
            print("Creating hierarchy_names table...", end=" ", flush=True)
            self.dst_cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS hierarchy_names (
                    hierarchy_id SERIAL PRIMARY KEY,
                    hierarchy_name VARCHAR(255) NOT NULL,
                    is_active BOOLEAN NOT NULL
                    )
            """
            )
            print("done.")
            print("Creating hierarchy table...", end=" ", flush=True)
            self.dst_cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS hierarchy (
                        region_id INTEGER,
                        parent_id INTEGER,
                        hierarchy_id INTEGER REFERENCES hierarchy_names(hierarchy_id),
                        region_name VARCHAR(255) NOT NULL,
                        has_subregions BOOLEAN NOT NULL,
                        PRIMARY KEY (region_id, hierarchy_id),
                        FOREIGN KEY (parent_id, hierarchy_id) REFERENCES hierarchy(region_id, hierarchy_id)
                    )
            """
            )
            print("done.")

            # Create a function to get the next region_id for a hierarchy. The id is unique within a hierarchy.
            print(
                "Creating a function to get the next region_id...", end=" ", flush=True
            )
            self.dst_cursor.execute(
                """
                CREATE OR REPLACE FUNCTION get_next_region_id(h_id INTEGER) RETURNS INTEGER AS $$
                DECLARE
                    next_id INTEGER;
                BEGIN
                    SELECT COALESCE(MAX(region_id), 0) + 1 INTO next_id FROM hierarchy WHERE hierarchy_id = h_id;
                    RETURN next_id;
                END;
                $$ LANGUAGE plpgsql;
            """
            )
            print("done.")

            # Create a trigger function to automatically set the region_id for a hierarchy
            print(
                "Creating a trigger function to automatically set the region_id...",
                end=" ",
                flush=True,
            )
            self.dst_cursor.execute(
                """
                CREATE OR REPLACE FUNCTION set_region_id() RETURNS TRIGGER AS $$
                BEGIN
                    IF NEW.region_id IS NULL THEN
                        NEW.region_id = get_next_region_id(NEW.hierarchy_id);
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
            """
            )
            print("done.")

            # Create a trigger to automatically set the region_id for a hierarchy
            print(
                "Creating a trigger to automatically set the region_id...",
                end=" ",
                flush=True,
            )
            self.dst_cursor.execute(
                """
                CREATE TRIGGER set_region_id_trigger
                BEFORE INSERT ON hierarchy
                FOR EACH ROW EXECUTE PROCEDURE set_region_id();
            """
            )
            print("done.")

            print("Creating hierarchy_region_mapping table...", end=" ", flush=True)
            self.dst_cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS hierarchy_region_mapping (
                        alt_region_id INTEGER,
                        hierarchy_id INTEGER REFERENCES hierarchy_names(hierarchy_id),
                        FOREIGN KEY (alt_region_id, hierarchy_id) REFERENCES hierarchy(region_id, hierarchy_id),
                        region_id INTEGER REFERENCES regions(id),
                        PRIMARY KEY (alt_region_id, hierarchy_id, region_id)
                    )
            """
            )
            print("done.")
        except psycopg2.OperationalError as e:
            print(f"Error: Could not create the hierarchy table: {e}")
            sys.exit(1)

    # Populate the Hierarchy table with the data from the regions table
    def populate_hierarchy_tables(self):
        # Step 0: Create the hierarchy_names record
        self.dst_cursor.execute(
            """
            INSERT INTO hierarchy_names (hierarchy_name, is_active)
            VALUES (%s, %s) RETURNING hierarchy_id
        """,
            ("Administrative Division", True),
        )
        hierarchy_id = self.dst_cursor.fetchone()[0]

        region_id_for_adm_hierarchy = 0

        # Step 1: Insert all regions into the hierarchies table without parent_id
        self.dst_cursor.execute("SELECT id, name, has_subregions FROM regions")
        regions = self.dst_cursor.fetchall()

        # Store the mapping of original ids in the regions table to region ids in the hierarchy table
        region_to_alt_id = {}

        timestamp = Timestamp(
            len(regions), "regions copied to administrative hierarchy"
        )
        for region_id, name, has_subregions in regions:
            timestamp.print()
            region_id_for_adm_hierarchy += 1
            self.dst_cursor.execute(
                """
                INSERT INTO hierarchy (region_id, hierarchy_id, region_name, parent_id, has_subregions)
                VALUES (%s, %s, %s, %s, %s) RETURNING region_id
            """,
                (region_id_for_adm_hierarchy, hierarchy_id, name, None, has_subregions),
            )
            alt_id = self.dst_cursor.fetchone()[0]
            region_to_alt_id[region_id] = alt_id
        timestamp.print_total()

        # Step 2: Update the parent_id in the hierarchy table
        timestamp = Timestamp(len(regions), "parent_id updated")
        for region_id, name, _ in regions:
            timestamp.print()
            self.dst_cursor.execute(
                "SELECT parent_region_id FROM regions WHERE id = %s", (region_id,)
            )
            parent_region_id = self.dst_cursor.fetchone()[0]

            if parent_region_id is not None:
                alt_parent_id = region_to_alt_id.get(parent_region_id)
                self.dst_cursor.execute(
                    """
                    UPDATE hierarchy SET parent_id = %s WHERE region_id = %s
                """,
                    (alt_parent_id, region_to_alt_id[region_id]),
                )
        timestamp.print_total()

        # Step 3: Populate the hierarchy_region_mapping table
        timestamp = Timestamp(len(region_to_alt_id), "mappings populated")
        for region_id, alt_id in region_to_alt_id.items():
            timestamp.print()
            self.dst_cursor.execute(
                """
                INSERT INTO hierarchy_region_mapping (alt_region_id, hierarchy_id, region_id)
                VALUES (%s, %s, %s)
            """,
                (alt_id, hierarchy_id, region_id),
            )
        timestamp.print_total()


if __name__ == "__main__":
    args = parse_args()

    gadm_file = args.source

    if not args.hierarchy_only and gadm_file is None:
        print("Error: Path to the GADM GeoPackage file must be provided with -s")
        sys.exit(1)

    # Check that the GeoPackage file exists
    if not args.hierarchy_only and not os.path.exists(gadm_file):
        print(f"Error: GeoPackage file {gadm_file} does not exist")
        sys.exit(1)

    # Read the DB credentials from .env files.
    db_name, db_user, db_password, db_host = get_db_credentials_from_env()

    global_timestamp_start = datetime.now()

    with DatabaseConnectionManager(
        db_host, db_name, db_user, db_password, gadm_file
    ) as (cur_dst, cur_src):
        records_processor = GADMRecordsProcessor(cur_src, cur_dst, gadm_file, args)

        if not args.hierarchy_only:
            # Create the Region table, if it doesn't exist
            records_processor.create_regions_table()

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

            print("Initializing the regions table...")
            records_processor.init_regions_table()
            print("Regions table initialization complete.")

            # Create indexes on the Region table for id
            print("Creating index for the id field...", end=" ", flush=True)
            cur_dst.execute("CREATE INDEX IF NOT EXISTS idx_id ON regions (id)")
            print("done.")

            if not args.fast:
                # Merge single children with their parents
                print("Merging single children with their parents...")
                records_processor.merge_single_children()
                print("Single children merging complete.")

            # Create indexes on the Region table
            print(
                "Creating index for the parent_region_id field...", end=" ", flush=True
            )
            cur_dst.execute(
                "CREATE INDEX IF NOT EXISTS idx_parent_region ON regions (parent_region_id)"
            )
            print("done.")
            # Create a GiST index on the geometry column
            if args.geometry:
                print("Creating geometry index...", end=" ", flush=True)
                cur_dst.execute(
                    "CREATE INDEX IF NOT EXISTS idx_geom ON regions USING GIST (geom)"
                )
                print("done.")

        # Generate Hierarchy table
        print("Generating Hierarchy table...")
        records_processor.create_hierarchy_tables()
        records_processor.populate_hierarchy_tables()
        print(
            "Creating index for the region_id, hierarchy_id fields in the hierarchy table...",
            end=" ",
            flush=True,
        )
        cur_dst.execute(
            "CREATE INDEX IF NOT EXISTS idx_region_hierarchy ON hierarchy (region_id, hierarchy_id)"
        )
        print("done.")
        print(
            "Creating index for the alt_region_id, hierarchy_id fields in the hierarchy_region_mapping table...",
            end=" ",
            flush=True,
        )
        cur_dst.execute(
            "CREATE INDEX IF NOT EXISTS idx_mapping_alt_regtion_id ON hierarchy_region_mapping (alt_region_id, hierarchy_id)"
        )
        print("done.")
        print(
            "Creating index for the region_id field in the hierarchy_region_mapping table...",
            end=" ",
            flush=True,
        )
        cur_dst.execute(
            "CREATE INDEX IF NOT EXISTS idx_mapping_region_id ON hierarchy_region_mapping (region_id)"
        )
        print("done.")
        print(f"DB init complete in {datetime.now() - global_timestamp_start} !")
