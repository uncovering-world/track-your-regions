import argparse
import math
import os
import sqlite3
import sys
from datetime import datetime

import psycopg2
from dotenv import load_dotenv
from osgeo import ogr


def find_next_non_empty_level(idx, feature_dict, geo_levels):
    for next_idx in range(idx + 1, len(geo_levels)):
        next_level_key = geo_levels[next_idx]
        if feature_dict[next_level_key]:
            return next_level_key
    return None


def print_timestamp(i, total_items, current_timestamp, loop_starttime, items_name="items"):
    items_in_one_percent = math.ceil(float(total_items) / 100)
    if i == 0 or i % items_in_one_percent != 0:
        return current_timestamp
    # Print a progress message every 1% of features and timestamp, how long it took
    time_now = datetime.now()
    time_diff = (time_now - current_timestamp).total_seconds()
    total_time_diff = (time_now - loop_starttime).total_seconds()
    estimated_time_left = (total_time_diff / (i / total_items)) - total_time_diff
    # Get the milliseconds part of the time difference
    ms_part = time_diff - int(time_diff)
    ms = f"{ms_part:.3f}".split(".")[1]
    estimated_time_left_human = datetime.fromtimestamp(estimated_time_left).strftime("%H:%M:%S")
    max_digits = len(str(total_items))
    print(
        f"Handled {int(i / items_in_one_percent):3d}% ({i:{max_digits}}/{total_items} {items_name}) - last batch in {time_diff:.2f} seconds. Estimated time left: {estimated_time_left_human}.{ms}")
    return datetime.now()


if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Script to initialize the regions table in the database.")
    parser.add_argument('gadm_file', help='Path to the GADM GeoPackage file.')
    parser.add_argument('-g', '--geometry', action='store_true', help='Adds the geometry to the regions table.')
    parser.add_argument('-f', '--fast', action='store_true', help='Fast mode - does not do postprocessing.')
    args = parser.parse_args()

    gadm_file = args.gadm_file

    # Check that the GeoPackage file exists
    if not os.path.exists(gadm_file):
        print(f"Error: GeoPackage file {gadm_file} does not exist")
        sys.exit(1)

    # Read the DB credentials from .env files.
    # The order of the files is important, as the variables are overwritten in the
    # order they are loaded.
    env_files = [".env", ".env.development", ".env.production", ".env.local"]
    for env_file in env_files:
        if os.path.exists(env_file):
            print(f"Loading environment variables from {env_file}")
            load_dotenv(env_file)

    db_name = os.getenv("DB_NAME")
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")

    # Check that the DB credentials were provided
    if db_name is None or db_user is None or db_password is None:
        print("Error: DB_NAME, DB_USER, and DB_PASSWORD must be provided in .env")
        sys.exit(1)

    # Connect to the PostgreSQL database
    print(f"Connecting to the database {db_name} as {db_user}...", end=" ")
    try:
        conn_pg = psycopg2.connect(f"dbname={db_name} user={db_user} password={db_password}")
    except psycopg2.OperationalError as e:
        print(f"Error: Could not connect to the database: {e}")
        sys.exit(1)
    print("done.")

    cur_pg = conn_pg.cursor()

    # Open GADM as a SQLite database
    print(f"Opening {gadm_file} as a SQLite database...", end=" ")
    try:
        conn_sqlite = sqlite3.connect(gadm_file)
    except sqlite3.OperationalError as e:
        print(f"Error: Could not open the GeoPackage as a SQLite database: {e}")
        sys.exit(1)
    print("done.")
    cur_sqlite = conn_sqlite.cursor()

    # Create the Region table, if it doesn't exist
    cur_pg.execute("""
        CREATE TABLE IF NOT EXISTS regions (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                parent_region_id INTEGER REFERENCES regions(id),
                has_subregions BOOLEAN NOT NULL,
                gadm_uid INTEGER,
                geom GEOMETRY(MULTIPOLYGON, 4326)
            )
        """)


    cur_sqlite.execute("""
        SELECT name FROM sqlite_master
        WHERE type='table'
        AND name NOT LIKE 'sqlite_%' 
        AND name NOT LIKE 'rtree_%'
        AND name NOT LIKE 'idx_%'
        AND name NOT LIKE 'gidx_%'
        AND name NOT LIKE 'gpkg_%'
        """)
    layers = [row[0] for row in cur_sqlite.fetchall()]

    if len(layers) != 1:
        print(f"Warning: Expected only one layer in GeoPackage, found {len(layers)}. Using first layer.")

    layer_name = layers[0]

    # List of the levels equal to "country", ordered by priority
    subcountry_levels = ['SOVEREIGN', 'GOVERNEDBY']
    # Update the properties list to include the predefined levels
    predefined_levels = ['CONTINENT', 'SUBCONT'] + subcountry_levels + ['COUNTRY', 'REGION']
    # Number of name levels in the GeoPackage (NAME_0 ... NAME_5)
    name_levels_num = 6
    # List of all properties requested from the GeoPackage
    properties = (predefined_levels +
                  [f'GID_{i}' for i in range(name_levels_num)] +
                  [f'NAME_{i}' for i in range(name_levels_num)] + ['UID', 'geom'])
    # List of geographical levels
    geo_levels = predefined_levels + [f'NAME_{i}' for i in range(name_levels_num)]

    records_num = conn_sqlite.execute(f"SELECT COUNT(*) FROM {layer_name}").fetchone()[0]

    existing_regions_paths = {}  # Dictionary to track existing regions
    single_children = {}  # Dictionary to track single children, in a form of {region_id: {name: ..., parent_id: ..., parent_name: ...}}

    global_timestamp_start = datetime.now()

    geometries = {}
    if args.geometry:
        print("Coping geometries into memory...")
        ds = ogr.Open(gadm_file)
        layer = ds.GetLayerByName(layer_name)

        # Read all the geometries from the GeoPackage
        timestamp = datetime.now()
        timestamp_start = timestamp
        for i, record in enumerate(layer):
            timestamp = print_timestamp(
                i, records_num, timestamp, timestamp_start, "geometries copied into memory"
            )
            gadm_uid = record.GetField("UID")
            geometry = record.GetGeometryRef().ExportToWkb()
            geometries[gadm_uid] = geometry
        print("Done")

    print(f"Processing {records_num} GADM records", end=" ")
    if args.geometry:
        print("with geometries", end=" ")
    if args.fast:
        print("without postprocessing", end="")
    print("...")
    timestamp = datetime.now()
    timestamp_start = timestamp
    cur_sqlite.execute(f"SELECT {', '.join(properties)} FROM {layer_name}")
    for i, row in enumerate(cur_sqlite):
        record = dict(zip(properties, row))
        record_subcountry = {"level": None, "name": None}

        timestamp = print_timestamp(i, records_num, timestamp, timestamp_start, "GADM records")

        # Reset for each new feature
        parent_region_id = None
        region_path_parts = []  # List to build up the path for the current region
        last_valid_parent_region_id = None
        last_valid_parent_region_path = None
        last_valid_parent_name = None

        # Identify the subcountry level for the current feature
        for level in subcountry_levels:
            if record[level]:
                record_subcountry["level"] = level
                record_subcountry["name"] = record[level]
                break

        # Process each geographical level for the current feature
        for idx, level in enumerate(geo_levels):
            name = record[level]

            # Skip empty levels
            if not name:
                continue

            # Skip unnecessary subcountry level
            if level in subcountry_levels:
                # Skip non-prioritized country levels
                if level != record_subcountry.get("level"):
                    continue
                # Skip subcountry levels if the identified subcountry level name is equal to the country level
                if record_subcountry.get("name") == record['COUNTRY']:
                    continue

            # Skip the NAME_0 level if it's the same as the country level
            # Sometimes the NAME_0 represents country, sometimes it represents a region within a country
            if level == 'NAME_0' and name == record['COUNTRY']:
                continue

            # We have skipped all the unnecessary levels, so we can form a unique key for the current region
            region_path_parts.append(name)  # Add the name to the path_parts list if it's not empty
            region_path = "_".join(region_path_parts)  # Build the unique key from the path_parts list

            # Determine if the current region has subregions
            next_level = find_next_non_empty_level(idx, record, geo_levels)
            has_subregions = next_level is not None  # Check if a non-empty level was found

            # We assign uid to the region, if it's the last level, and it has no subregions,
            # as only such regions have a unique uid in GADM.
            if has_subregions:
                uid = None
                geom = None
            else:
                uid = record['UID']
                geom = None if not args.geometry else geometries[uid]

            if region_path not in existing_regions_paths:
                query = """
                    INSERT INTO regions (name, has_subregions, parent_region_id, gadm_uid, geom)
                    VALUES (%s, %s, %s, %s, ST_GeomFromWKB(%s, 4326))
                    RETURNING id
                """
                params = (name, has_subregions, last_valid_parent_region_id, uid, geom)
                cur_pg.execute(query, params)
                region_id = cur_pg.fetchone()[0]
                existing_regions_paths[region_path] = { "id": region_id, }
                # If not in fast mode, append the information that tracks single children and
                # helps to merge them with their parents later during the postprocessing
                if not args.fast:
                    existing_regions_paths[region_path].update({
                        "name": name,
                        "children_num": 0,
                        "parent_id": last_valid_parent_region_id
                    })
                # If the region has a parent, update the parent's children_num and single_child
                # It is necessary to detect single children and merge them with their parents later
                # Skip it if the fast mode is enabled
                if not args.fast and last_valid_parent_region_path:
                    existing_regions_paths[last_valid_parent_region_path]["children_num"] += 1
                    if existing_regions_paths[last_valid_parent_region_path]["children_num"] == 1:
                        # Mark as potentially single child, as it's the first child found for the parent
                        single_children[region_id] = {
                            "name": name,
                            "path": region_path,
                            "parent_id": last_valid_parent_region_id,
                            "parent_path": last_valid_parent_region_path,
                            "parent_name": last_valid_parent_name
                        }
                        # Save the potential single child ID to the parent region
                        existing_regions_paths[last_valid_parent_region_path]["single_child"] = region_id
                    elif existing_regions_paths[last_valid_parent_region_path]["children_num"] == 2:
                        # The second child was found, so remove the sibling from the list of single children
                        sibling_id = existing_regions_paths[last_valid_parent_region_path]["single_child"]
                        # Remove the sibling from the list of single children
                        del single_children[sibling_id]
                        del existing_regions_paths[last_valid_parent_region_path]["single_child"]
            else:
                # If the region already exists, get its ID
                region_id = existing_regions_paths[region_path]["id"]

            # Update the parent region info for the next iteration
            last_valid_parent_region_id = region_id
            last_valid_parent_name = name
            last_valid_parent_region_path = region_path
    print("Initial DB creation complete.")

    if not args.fast:
        # Merge single children with their parents
        print("Merging single children with their parents...")
        single_children_len = len(single_children)
        timestamp = datetime.now()
        timestamp_start = timestamp
        for i, single_child_id in enumerate(single_children):
            timestamp = print_timestamp(i, single_children_len, timestamp, timestamp_start, "single children")
            # Merge the single child with its parent only if they have the same name
            single_child = single_children[single_child_id]
            if single_child["name"] == single_child["parent_name"]:
                # Remove the parent region and update the single child's parent ID
                # First - get the parent region's parent ID
                new_parent_region_id = existing_regions_paths[single_child["parent_path"]]["parent_id"]
                # Second - update the single child's parent ID
                cur_pg.execute("UPDATE regions SET parent_region_id = %s WHERE id = %s", (new_parent_region_id, single_child_id))
                # Do not forget to update the single child's parent ID in the dictionary
                existing_regions_paths[single_child["path"]]["parent_id"] = new_parent_region_id
                # Third - delete the parent region
                cur_pg.execute("DELETE FROM regions WHERE id = %s", (single_child["parent_id"],))
                del existing_regions_paths[single_child["parent_path"]]
        print("DB postprocessing complete.")

    print("Creating indexes.")
    # Create indexes on the Region table
    print("Creating parents index...", end=" ", flush=True)
    cur_pg.execute("CREATE INDEX IF NOT EXISTS parent_region_idx ON regions (parent_region_id)")
    print("done.")
    # Create a GiST index on the geometry column
    if args.geometry:
        print("Creating geometry index...", end=" ", flush=True)
        cur_pg.execute("CREATE INDEX IF NOT EXISTS geom_idx ON regions USING GIST (geom)")
        print("done.")
    print("Indexes created.")
    print(f"DB init complete in {datetime.now() - global_timestamp_start} !")

    # Commit the changes and close the connections
    conn_pg.commit()
    cur_pg.close()
    conn_pg.close()

    cur_sqlite.close()
    conn_sqlite.close()
