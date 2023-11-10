import argparse
import os
import random
import sys

import openai
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
import psycopg2
from dotenv import load_dotenv


def save_error_report(region_id, gadm_uid, hierarchy, feedback):
    try:
        with open(error_report_file, "a") as file:
            file.write(f"Region ID: {region_id}, GADM ID: {gadm_uid}\n{hierarchy}\n{feedback}\n\n")
    except IOError as e:
        print(f"Error during file ({error_report_file}) operation: {e}")


def add_to_cache(region_id, gadm_uid):
    try:
        with open(checked_cache_file, "a") as file:
            file.write(f"{region_id},{gadm_uid}\n")
    except IOError as e:
        print(f"Error during file ({checked_cache_file}) operation: {e}")


# Function to color text red in terminal
def red_text(text):
    return f"\033[91m{text}\033[0m"


def load_cache():
    try:
        with open(checked_cache_file, "r") as file:
            return {line.strip().split(',')[0] for line in file}
    except FileNotFoundError:
        return set()


def get_max_region_id():
    cur.execute("SELECT MAX(id) FROM regions")
    return cur.fetchone()[0]


def get_hierarchy(region_id):
    hierarchy = []
    while region_id:
        cur.execute("SELECT name, parent_region_id FROM regions WHERE id = %s", (region_id,))
        row = cur.fetchone()
        if row:
            name, parent_region_id = row
            hierarchy.append(name)
            region_id = parent_region_id
        else:
            break
    return " > ".join(reversed(hierarchy))


error_report_file = "error_reports.txt"
checked_cache_file = ".checked_cache"

# Read the DB credentials from .env files.
env_files = [".env", ".env.development", ".env.production", ".env.local"]
for env_file in env_files:
    if os.path.exists(env_file):
        print(f"Loading environment variables from {env_file}")
        load_dotenv(env_file)

db_name = os.getenv("DB_NAME")
db_user = os.getenv("DB_USER")
db_password = os.getenv("DB_PASSWORD")
db_host = os.getenv("DB_HOST", 'localhost')


# Check that the DB credentials were provided
if not all([db_name, db_user, db_password, openai.api_key]):
    print("Error: DB_NAME, DB_USER, DB_PASSWORD, and OPENAI_API_KEY must be provided in .env")
    sys.exit(1)

# Setup argument parser
parser = argparse.ArgumentParser(description="Script to validate region hierarchies with OpenAI API.")
parser.add_argument('-c', '--cheap', action='store_true', help='Use the gpt-3.5-turbo model instead of gpt-4.')
parser.add_argument('-n', '--num-regions', type=int, default=10, help='Number of random regions to check.')

# Parse arguments
args = parser.parse_args()

# Use the specified model based on the --cheap flag
model_to_use = "gpt-3.5-turbo" if args.cheap else "gpt-4"

# Use the specified number of regions to check
num_regions_to_check = args.num_regions

# Connect to your database
conn = psycopg2.connect(dbname=db_name, user=db_user, password=db_password, host=db_host)
cur = conn.cursor()


checked_regions = load_cache()
max_id = get_max_region_id()

# Exclude the checked regions from the possible ID range
possible_ids = set(range(1, max_id + 1)) - checked_regions
possible_ids_list = list(possible_ids) # Convert to list for random sampling
region_ids = random.sample(possible_ids_list, min(num_regions_to_check, len(possible_ids_list)))


error_mark = "WARNING"

initial_prompt = (
    "Review the following region hierarchy and provide feedback. Look for any discrepancies such as incorrect region"
    "names, out-of-place elements, or non-standard abbreviations that don't fit typical administrative divisions. Reply"
    f"'yes' if the hierarchy is correct without any issues. Reply '{error_mark}' with details if it's not, and explain"
    "what seems incorrect or out of place."
)

# Validate region hierarchy data for selected regions
for region_id in region_ids:
    cur.execute("SELECT gadm_uid FROM regions WHERE id = %s", (region_id,))
    result = cur.fetchone()  # Store the result of fetchone
    gadm_uid = result[0] if result else None  # Check if result is not None before subscripting
    hierarchy = get_hierarchy(region_id)
    title_message = f"Validating region hierarchy: {hierarchy}"
    print(f"{'-' * len(title_message)}")
    print(f"Validating region hierarchy: {hierarchy}")  # Tab at the beginning for separation
    try:
        response = client.chat.completions.create(model=model_to_use,
        messages=[
            {"role": "system", "content": initial_prompt},
            {"role": "user", "content": hierarchy}
        ],
        max_tokens=150)
        feedback = response['choices'][0]['message']['content'].strip()
        if error_mark in feedback:
            # Red text for the error message part only
            print(f"{red_text('Potential error in region:')} {region_id}")
            # Normal color for feedback
            print(feedback)
            save_error_report(region_id, gadm_uid, hierarchy, feedback)
        else:
            add_to_cache(region_id, gadm_uid)
    except openai.OpenAIError as e:
        # Red text for exceptions
        print(red_text(f"Error: {e}"))
        continue  # Continue with the next iteration

# Close database connection
cur.close()
conn.close()
