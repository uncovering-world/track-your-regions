# Region Hierarchy Validation Script

This script is designed to validate region hierarchy data within a database using the OpenAI API. It allows you to
select a random set of regions and validate their hierarchical data by leveraging OpenAI's powerful natural language
understanding capabilities.

## Getting Started

These instructions will guide you through setting up and running the script on your local machine for development and
testing purposes.

### Prerequisites

Before running the script, ensure that you have the following prerequisites installed on your system:

- Python 3.6 or higher
- pip (Python package installer)
- The TYR database is initialized and running on your local machine

### Installation

First, clone the repository or download the script to your local machine. Navigate to the script's directory and install
the required Python packages:

```bash
pip install -r requirements.txt
```

### Configuration

Copy the `.env.development.example` file to create a `.env` file that matches your local development environment:

```bash
cp .env.development.example .env
```

Edit the `.env` file to include your PostgreSQL database credentials and your OpenAI API key:

```env
DB_NAME=your_db_name
DB_USER=your_db_user
DB_PASSWORD=your_db_password
OPENAI_API_KEY=your_openai_api_key
```

OpenAI API keys can be generated from the [OpenAI API Keys](https://platform.openai.com/account/api-keys) page.

### Usage

To run the script, use the following command:

```bash
python validate-db.py
```

You can use optional flags to customize the script's behavior:

- `-c`, `--cheap`: Use the cheaper `gpt-3.5-turbo` model instead of the default `gpt-4`.
- `-n`, `--num-regions`: Specify the number of random regions to check (default is 10).

Example of running the script with flags:

```bash
python validate-db.py --cheap --num-regions=5
```

### Output

The script will print the hierarchy validation results to the console. If any discrepancies are found, an error report
will be generated and appended to the `error_reports.txt` file. Additionally, the script maintains a cache of checked
region IDs to avoid redundant validations.