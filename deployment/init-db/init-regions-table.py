from datetime import datetime
import os
import sqlite3
import sys

from dotenv import load_dotenv
import fiona
import psycopg2

# Check that the GeoPackage file was provided
if len(sys.argv) < 2:
    print("Usage: python init-regions-table.py <path-to-gadm.gpkg>")
    sys.exit(1)

# Connect to the GeoPackage as an SQLite database
gadm_file = sys.argv[1]
conn_gpkg = sqlite3.connect(gadm_file)
cur_gpkg = conn_gpkg.cursor()

# Read the DB credentials from .env
load_dotenv()
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

# Create the Region table, if it doesn't exist
cur_pg.execute("""
    CREATE TABLE IF NOT EXISTS regions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        parent_region_id INTEGER REFERENCES regions(id),
        has_subregions BOOLEAN NOT NULL,
        gadm_uid INTEGER
    )
""")

# Get the layer name from the GeoPackage
layers = fiona.listlayers(gadm_file)

# We expect only one layer in the GeoPackage, print a warning if there are more
if len(layers) != 1:
    print(f"Warning: Expected only one layer in GeoPackage, found {len(layers)}. Using first layer.")

layer_name = layers[0]

# Number of levels in the GADM hierarchy
num_levels = 6

# Update the columns list to include the predefined levels
predefined_levels = ['CONTINENT', 'SUBCONT', 'SOVEREIGN', 'COUNTRY', 'GOVERNEDBY', 'REGION']
columns = predefined_levels + [f'GID_{i}' for i in range(num_levels)] + [f'NAME_{i}' for i in range(num_levels)] + ['UID']

# Fetch the relevant columns from the GeoPackage
cur_gpkg.execute(f"SELECT {','.join(columns)} FROM {layer_name}")
rows = cur_gpkg.fetchall()

# Now you can access the predefined levels in your row_dict as they are part of the columns list
geo_levels = predefined_levels + [f'NAME_{i}' for i in range(num_levels)]

# Get the number of rows in the GeoPackage
num_rows = len(rows)
print(f"Processing {num_rows} rows...")
# Get the number of digits in the number of rows, to format the progress message
max_row_digits = len(str(num_rows))

# Print a progress message every 1% of rows
rows_in_one_percent = int(num_rows / 100)

timestamp = datetime.now()
timestamp_start = timestamp


def find_next_non_empty_level(idx, row_dict, geo_levels):
    # Function to find the next non-empty level in the hierarchy
    for next_idx in range(idx + 1, len(geo_levels)):
        next_level_key = geo_levels[next_idx]
        if row_dict.get(next_level_key, '') != '':
            return next_level_key
    return None  # Return None if no non-empty level is found


existing_names = {}  # Dictionary to track existing regions

# Loop through the rows from the SQLite cursor
for i, row in enumerate(rows):
    if i % rows_in_one_percent == 0 and i > 0:
        # Print a progress message every 1% of rows and timestamp, how long it took
        time_now = datetime.now()
        time_diff = (time_now - timestamp).total_seconds()
        total_time_diff = (time_now - timestamp_start).total_seconds()
        estimated_time_left = (total_time_diff / (i / num_rows)) - total_time_diff
        print(f"Handled {int(i / rows_in_one_percent):3d}% ({i:{max_row_digits}} rows) - last batch in {time_diff:.2f} seconds. Estimated time left: {estimated_time_left:.2f} seconds")
        timestamp = datetime.now()

    row_dict = {}
    for column, value in zip(columns, row):
        row_dict[column] = value

    # Reset parent_region_id for each new row
    parent_region_id = None
    last_valid_parent_region_id = None  # Variable to remember the last valid parent ID
    path_parts = []  # List to build up the path for the current region

    # Process each geographical level for the current row
    for idx, level in enumerate(geo_levels):
        if row_dict.get(level) is None:
            continue
        name = row_dict[level]
        if name:
            path_parts.append(name)  # Add the name to the path_parts list if it's not empty
            key = "_".join(path_parts)  # Build the unique key from the path_parts list

            # Determine if the current region has subregions
            next_level = find_next_non_empty_level(idx, row_dict, geo_levels)  # Find the next non-empty level
            has_subregions = next_level is not None  # Check if a non-empty level was found

            # We assign uid to the region, if it is a real GADM region, not a region we created to fill the
            # hierarchy. Marker for this is that it's the last level, and it has no subregions. For the created
            # regions, we don't have a uid, so we set it to None
            if has_subregions:
                uid = None
            else:
                uid = row_dict.get('UID')
                if uid is None:
                    print("Warning: UID is None for region: ", key)

            if key not in existing_names:
                # If the region doesn't exist, create it
                # Use last_valid_parent_region_id as the parent_region_id for the current level
                query = "INSERT INTO regions (name, has_subregions, parent_region_id, gadm_uid) VALUES (%s, %s, %s, %s) RETURNING id"
                params = (name, has_subregions, last_valid_parent_region_id, uid)
                cur_pg.execute(query, params)
                region_id = cur_pg.fetchone()[0]
                existing_names[key] = region_id
            else:
                # If the region already exists, get its ID
                region_id = existing_names[key]

            # Update last_valid_parent_region_id for the next level
            last_valid_parent_region_id = region_id

print("Done, in total: ", datetime.now() - timestamp_start)

print("Creating indexes...")
# Create indexes on the Region table
cur_pg.execute("CREATE INDEX IF NOT EXISTS parent_region_idx ON regions (parent_region_id)")
print("Done")

# Commit the changes and close the connections
conn_pg.commit()
cur_gpkg.close()
conn_gpkg.close()
cur_pg.close()
conn_pg.close()
