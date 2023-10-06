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
        parentRegionId INTEGER REFERENCES regions(id),
        hasSubregions BOOLEAN NOT NULL
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

# List of columns to fetch from the GeoPackage: GID_0, GID_1, ..., GID_5, NAME_0, NAME_1, ..., NAME_5
columns = [f'GID_{i}' for i in range(num_levels)] + [f'NAME_{i}' for i in range(num_levels)]

# Fetch the relevant columns from the GeoPackage
cur_gpkg.execute(f"SELECT {','.join(columns)} FROM {layer_name}")
rows = cur_gpkg.fetchall()

# Get the number of rows in the GeoPackage
num_rows = len(rows)
print(f"Processing {num_rows} rows...")
# Get the number of digits in the number of rows, to format the progress message
max_row_digits = len(str(num_rows))

# Print a progress message every 1% of rows
rows_in_one_percent = int(num_rows / 100)

timestamp = datetime.now()
timestamp_start = timestamp

existing_gids = {}


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

    parent_region_id = None
    # Recreate the regions, starting from the highest level
    for level in range(num_levels):
        gid = row_dict[f'GID_{level}']
        if not gid:
            # If the GID is empty, finish processing the row
            break
        name = row_dict[f'NAME_{level}']

        if not existing_gids.get(gid):
            # If the region doesn't exist, create it
            # Check if the region has a subregion in this row
            has_subregions = level < num_levels - 1 and bool(row_dict[f'GID_{level + 1}'])
            # Use query parameters to give the database driver a chance to escape the values
            query = "INSERT INTO regions (name, hasSubregions, parentRegionId) VALUES (%s, %s, %s) RETURNING id"
            params = (name, has_subregions, parent_region_id)
            cur_pg.execute(query, params)
            region_id = cur_pg.fetchone()[0]
            existing_gids[gid] = region_id
        else:
            # If the region already exists, get its ID
            region_id = existing_gids[gid]

        parent_region_id = region_id

print("Done, in total: ", datetime.now() - timestamp_start)

print("Creating indexes...")
# Create indexes on the Region table
cur_pg.execute("CREATE INDEX IF NOT EXISTS parent_region_idx ON regions (parentRegionId)")
print("Done")

# Commit the changes and close the connections
conn_pg.commit()
cur_gpkg.close()
conn_gpkg.close()
cur_pg.close()
conn_pg.close()
