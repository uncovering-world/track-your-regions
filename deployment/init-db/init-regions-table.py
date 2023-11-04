from datetime import datetime
import os
import sys
import sqlite3

from dotenv import load_dotenv
import psycopg2
from osgeo import ogr

# Check that the GeoPackage file was provided
if len(sys.argv) < 2:
    print("Usage: python init-regions-table.py <path-to-gadm.gpkg>")
    sys.exit(1)

# Connect to the GeoPackage as an SQLite database
gadm_file = sys.argv[1]

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

print("Connecting to the database...")

# Connect to the PostgreSQL database
conn_pg = psycopg2.connect(f"dbname={db_name} user={db_user} password={db_password}")
cur_pg = conn_pg.cursor()

# Open a connection to the GeoPackage as an SQLite database
conn_sqlite = sqlite3.connect(gadm_file)
cursor_sqlite = conn_sqlite.cursor()

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

# Open the GeoPackage file
ds = ogr.Open(gadm_file)
# Check if the dataset exists
if ds is None:
    print("Could not open GeoPackage")
    sys.exit(1)

# Get the layer name from the GeoPackage
layer_count = ds.GetLayerCount()
layers = [ds.GetLayerByIndex(i).GetName() for i in range(layer_count)]

if len(layers) != 1:
    print(f"Warning: Expected only one layer in GeoPackage, found {len(layers)}. Using first layer.")

layer_name = layers[0]

# Open the layer by name
lyr = ds.GetLayerByName(layer_name)

# Number of levels in the GADM hierarchy
num_levels = 6

# List of the levels equal to "country", ordered by priority
subcountry_levels = ['SOVEREIGN', 'GOVERNEDBY']
# Update the properties list to include the predefined levels
predefined_levels = ['CONTINENT', 'SUBCONT'] + subcountry_levels + ['COUNTRY', 'REGION']
# List of all properties requested from the GeoPackage
properties = predefined_levels + [f'GID_{i}' for i in range(num_levels)] + [f'NAME_{i}' for i in range(num_levels)] + ['UID', 'geom']

# List of geographical levels
geo_levels = predefined_levels + [f'NAME_{i}' for i in range(num_levels)]

# Prepare for looping through features
num_features = lyr.GetFeatureCount()

print(f"Processing {num_features} features...")
# Get the number of digits in the number of features, to format the progress message
max_feature_digits = len(str(num_features))

# Print a progress message every 1% of features
features_in_one_percent = int(num_features / 100)

timestamp = datetime.now()
timestamp_start = timestamp

last_valid_parent_region_id = None  # Variable to remember the last valid parent ID


def find_next_non_empty_level(idx, feature, geo_levels, has_siblings):
    for next_idx in range(idx + 1, len(geo_levels)):
        next_level_key = geo_levels[next_idx]
        if feature.GetField(next_level_key):
            if feature.GetField(next_level_key) == feature.GetField(geo_levels[idx]):
                if not has_siblings:
                    continue
            return next_level_key
    return None


def has_siblings_sqlite(feature, level, geo_levels, lyr_name):
    # Determine the index of the current level
    level_index = geo_levels.index(level)

    if existing_names.get(last_valid_parent_path_key, {}).get("children_num", 0) > 0:
        return True

    # Start building the WHERE clause for the SQL query
    where_clauses = []
    query_params = []

    # Loop over all parent levels
    for parent_level_index in range(level_index):
        parent_level = geo_levels[parent_level_index]
        parent_name = feature.GetField(parent_level)
        if parent_name:
            # Add the condition to match the parent level name
            where_clauses.append(f"{parent_level} = ?")
            query_params.append(parent_name)

    # Add the condition to exclude the current feature's name
    where_clauses.append(f"{level} <> ?")
    query_params.append(feature.GetField(level))

    # Combine all WHERE clauses
    where_clause = " AND ".join(where_clauses)

    # Build the full SQL query
    sql_query = f"SELECT COUNT(*) FROM {lyr_name} WHERE {where_clause} AND {level} != ''"

    # Execute the query with all collected parameters
    cursor_sqlite.execute(sql_query, query_params)
    result = cursor_sqlite.fetchone()

    # Check if siblings exist
    if result[0] == 0:
        print("No siblings for", feature.GetField(level), "in", feature.GetField('NAME_0'), " id:", feature.GetField('UID'))
    return result[0] > 0


existing_names = {}  # Dictionary to track existing regions
identified_subcountry_levels = {}  # Dictionary to track identified subcountry levels per feature
identified_subcountry_names = {}  # Dictionary to track identified subcountry names per feature
last_valid_parent_name = None  # Variable to remember the last valid parent name

for i, feature in enumerate(lyr):
    if i % features_in_one_percent == 0 and i > 0:
        # Print a progress message every 1% of features and timestamp, how long it took
        time_now = datetime.now()
        time_diff = (time_now - timestamp).total_seconds()
        total_time_diff = (time_now - timestamp_start).total_seconds()
        estimated_time_left = (total_time_diff / (i / num_features)) - total_time_diff
        print(f"Handled {int(i / features_in_one_percent):3d}% ({i:{max_feature_digits}} features) - last batch in {time_diff:.2f} seconds. Estimated time left: {estimated_time_left:.2f} seconds")
        timestamp = datetime.now()

    # Reset parent_region_id for each new feature
    parent_region_id = None
    last_valid_parent_region_id = None  # Variable to remember the last valid parent ID
    path_parts = []  # List to build up the path for the current region
    last_valid_parent_path_key = None  # Variable to remember the last valid parent path key

    # Reset parent_region_id and other variables for each new feature
    last_valid_parent_name = None

    # Identify the subcountry level for the current feature
    for level in subcountry_levels:
        if feature.GetField(level):
            identified_subcountry_levels[feature.GetField('UID')] = level
            identified_subcountry_names[feature.GetField('UID')] = feature.GetField(level)
            break

    # Process each geographical level for the current feature
    for idx, level in enumerate(geo_levels):
        name = feature.GetField(level)

        # Skip empty levels
        if not name:
            continue

        # Skip non-prioritized country levels
        if level in subcountry_levels and level != identified_subcountry_levels.get(feature.GetField('UID')):
            continue

        # Skip subcountry levels if the identified subcountry level name is equal to the country level
        if level in subcountry_levels and identified_subcountry_names.get(feature.GetField('UID')) == feature.GetField('COUNTRY'):
            continue

        # Skip the NAME_0 level if it's the same as the country level
        # Sometimes the NAME_0 represents country, sometimes it represents a region within a country
        if level == 'NAME_0' and name == feature.GetField('COUNTRY'):
            continue

        has_siblings = existing_names.get(last_valid_parent_path_key, {}).get("children_num", 0) > 0
        # Skip levels with the same name as the last valid parent
        if name == last_valid_parent_name:
            has_siblings = has_siblings_sqlite(feature, level, geo_levels, layer_name)
            if not has_siblings:
                continue

        path_parts.append(name)  # Add the name to the path_parts list if it's not empty
        key = "_".join(path_parts)  # Build the unique key from the path_parts list

        # Determine if the current region has subregions
        next_level = find_next_non_empty_level(idx, feature, geo_levels, has_siblings)  # Find the next non-empty level
        has_subregions = next_level is not None  # Check if a non-empty level was found

        # We assign uid and geometry to the region, if it is a real GADM region, not a region we created to fill the
        # hierarchy. Marker for this is that it's the last level, and it has no subregions. For the created
        # regions, we don't have a uid and geometry, so we set it to None
        if has_subregions:
            uid = None
            geom = None
        else:
            uid = feature.GetField('UID')
            geom = feature.GetGeometryRef().ExportToWkb()

        if key not in existing_names:
            query = """
                INSERT INTO regions (name, has_subregions, parent_region_id, gadm_uid, geom)
                VALUES (%s, %s, %s, %s, ST_GeomFromWKB(%s, 4326))
                RETURNING id
            """
            params = (name, has_subregions, last_valid_parent_region_id, uid, geom)
            cur_pg.execute(query, params)
            region_id = cur_pg.fetchone()[0]
            existing_names[key] = {"id": region_id, "children_num": 0}
            if last_valid_parent_path_key:
                existing_names[last_valid_parent_path_key]["children_num"] += 1
        else:
            # If the region already exists, get its ID
            region_id = existing_names[key]["id"]

        # Update last_valid_parent_region_id for the next level
        last_valid_parent_region_id = region_id

        # Update last_valid_parent_name for the next level
        last_valid_parent_name = name

        # Update the last_valid_parent_path_key
        last_valid_parent_path_key = key

print("Done, in total: ", datetime.now() - timestamp_start)

print("Creating indexes...")
# Create indexes on the Region table
cur_pg.execute("CREATE INDEX IF NOT EXISTS parent_region_idx ON regions (parent_region_id)")
# Create a GiST index on the geometry column
cur_pg.execute("CREATE INDEX IF NOT EXISTS geom_idx ON regions USING GIST (geom)")
print("Done")

# Commit the changes and close the connections
conn_pg.commit()
cur_pg.close()
conn_pg.close()
conn_sqlite.close()
