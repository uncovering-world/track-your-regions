# Backend Service for Region Tracker

## Overview

This directory contains the backend code for the Region Tracker service,
including logic, database interactions, and API endpoints.

## Tech Stack

- **Node.js**: The runtime environment for executing JavaScript server-side.
- **Express**: A web framework for Node.js.
- **Sequelize**: A promise-based Node.js ORM for SQL databases.
- **PostgreSQL**: The database used for storing application data.
- **Docker**: Used for containerizing the backend service for quick setup and
  testing.

## Code Style

We use [Airbnb's JavaScript style guide](https://github.com/airbnb/javascript)
for this project.
To ensure that the codebase adheres to this style guide, we use eslint to lint
the codebase. The configuration file is `.eslintrc`.

To run the linter, use the following command:

```bash
npm run lint
```

To automatically fix linting errors, use the following command:

```bash
npm run lint:fix
```

## Directory Structure

```plaintext
.
├── config/                      # Global configuration files
│   └── config.js                # Configuration read from environment variables
├── migrations/                  # Database migration files
├── src/                         # Main application source code
│   ├── config/                  # Runtime configuration files
│   │   └── db.js                # Database configuration
│   ├── controllers/             # Business logic for API endpoints
│   │   └── regionController.js  # Controller for region-related operations
│   ├── models/                  # Sequelize models
│   │   ├── index.js             # Entry point for models
│   │   └── Region.js            # Model for the region table
│   ├── routes/                  # API routes
│   │   ├── index.js             # Main route file
│   │   └── regionRoutes.js      # Routes for region-related operations
│   ├── app.js                   # Main application file
│   └── server.js                # Server setup
├── test/                        # Test files
├── Dockerfile                   # Dockerfile for containerization
│                                # (for docker-compose use only)
├── package.json                 # Project metadata and dependencies
└── README.md                    # Project documentation
```

## Environment Configuration (.env)

Multiple `.env` files can be used to separate environment variables based on the
environment where the application is running. The hierarchy is as follows:

- `.env`: Common settings
- `.env.development`: For development settings
- `.env.production`: For production settings
- `.env.local`: For local overrides

The repository contains an example `.env.development` file.

### Example `.env` File

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=track_your_regions
TEST_SERVER_PORT=3000
```

## Usage

### With Docker Compose

The `Dockerfile` in this directory is intended solely for use
by `docker-compose`. While it can work independently, it's not recommended. For
individual service testing and debugging, it's advised to use npm directly.

To run the backend service as part of the full stack, refer to the
main `README.md` in the `deployment/` directory for instructions on
using `docker-compose`.

### Without Docker Compose

To run the backend service individually:

```bash
npm install
npm run debug
```

## Available Targets

You can run the following npm scripts to perform various tasks:

- `npm run test`: Run tests (currently not specified).
- `npm run debug`: Run debugging server, using nodemon.
- `npm run migrate`: Run database migrations.
- `npm run migrate:undo`: Undo the last database migration.
- `npm run migrate:generate`: Generate a new migration file.
- `npm run lint`: Run ESLint on the project.
- `npm run lint:fix`: Run ESLint on the project and fix any fixable errors.

## Database Migrations

We use Sequelize migrations to manage the database schema. Migration files are
located in the `migrations/` directory.

### Using migrate:generate to Generate a New Migration File

The `migrate:generate` script is a convenient way to generate a new migration
file. This script uses Sequelize CLI to
create a new migration file in the `migrations/` directory.

```shell
npm run migrate:generate -- --name <name-of-your-migration>
```

Let's say you want to create a new migration for adding a email column to a
users table. You can run:

```shell
npm run migrate:generate -- --name add-email-to-users
```

This will generate a new file in the `migrations/` directory, something
like `XXXXXXXXXXXXXX-add-email-to-users.js`,
where `XXXXXXXXXXXXXX` is a timestamp.

## Some Implementation Details

### Search Functionality

#### Search Algorithm

- Advanced relevance scoring based on query term matches in `region_name` and
  hierarchical paths.
- Prioritization of exact matches, ordered term sequences, and direct path
  matches.

#### Performance Optimization

To optimize search performance, the following techniques are used:

- PostgreSQL indices on `region_name` (GIN), `hierarchy_id`, and `parent_id`
  fields in the `hierarchy` table.
- Use of GIN index with `pg_trgm` extension for efficient text search.
