# Backend Service for Region Tracker

## Overview

This directory contains the backend code responsible for handling the logic,
database interactions, and API endpoints for the Region Tracker service.

## Tech Stack

This backend is built using the following technologies:

- **Node.js**: The runtime environment for executing JavaScript server-side.
- **Express**: A fast, unopinionated web framework for Node.js.
- **Sequelize**: A promise-based Node.js ORM for SQL databases.
- **PostgreSQL**: The database used for storing application data.

## Directory Structure

```plaintext
.
├── config/                      # Global configuration files
│   └── sequelizeConfig.js       # Sequelize configuration
├── migrations/                  # Database migration files
├── src/                         # Main application source code
│   ├── config/                  # Configuration files used by the application in runtime
│   │   └── db.js                # Database configuration
│   ├── controllers/             # Business logic for API endpoints
│   │   └── regionController.js  # Controller for region-related operations
│   ├── models/                  # Sequelize models
│   │   ├── index.js             # Entry point for models
│   │   └── Region.js            # Model for region table
│   ├── routes/                  # API routes
│   │   ├── index.js             # Main route file
│   │   └── regionRoutes.js      # Routes for region-related operations
│   ├── app.js                   # Main application file
│   └── server.js                # Server setup
├── test/                        # Test files
├── package.json                 # Project metadata and dependencies
└── README.md                    # Project documentation
```

## Environment Configuration (.env)

The `.env` file is used to store environment variables that are required for the application to run. This file is not
checked into version control to keep sensitive information like API keys, database passwords, etc., secure.

### Example `.env` File

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=track_your_regions
TEST_SERVER_PORT=3000
```

The `.env` file is primarily used in the following files:

- `src/config/db.js`: For database configuration.
- `src/server.js`: For setting up the server port and other server-related configurations.
- `config/sequelizeConfig.js`: For Sequelize database configuration.

## Available Targets

You can run the following npm scripts to perform various tasks:

- `npm run test`: Run tests (currently not specified).
- `npm run debug`: Run debugging server, using nodemon.
- `npm run migrate`: Run database migrations.
- `npm run migrate:undo`: Undo the last database migration.
- `npm run migrate:generate`: Generate a new migration file.

## Database Migrations

We use Sequelize migrations to manage the database schema. Migration files are located in the `migrations/` directory.

### Using migrate:generate to Generate a New Migration File

The `migrate:generate` script is a convenient way to generate a new migration file. This script uses Sequelize CLI to
create a new migration file in the `migrations/` directory.

```shell
npm run migrate:generate -- --name <name-of-your-migration>
```

Let's say you want to create a new migration for adding a email column to a users table. You can run:

```shell
npm run migrate:generate -- --name add-email-to-users
```

This will generate a new file in the `migrations/` directory, something like `XXXXXXXXXXXXXX-add-email-to-users.js`,
where `XXXXXXXXXXXXXX` is a timestamp.

## Guidelines

- Keep the codebase clean and well-documented to ensure maintainability.
- Follow best practices for security, especially when dealing with user data and
  authentication.
- Adhere to the established coding standards and naming conventions for
  consistency.
- Ensure that any new features or endpoints are accompanied by appropriate unit
  tests.
