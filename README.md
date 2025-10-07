# Region Tracker

## Introduction

The goal of Region Tracker is to provide a web service that helps users keep
track of regions they have visited and experiences they have had. The platform
aims to offer a comprehensive, hierarchically-structured list of predefined
regions and associated experiences, making travel tracking both detailed and
enriching.

## Wiki

We maintain a [wiki](https://github.com/OhmSpectator/track-your-regions/wiki)
that tracks all the design documents related to this project. This is a central
place where you can find detailed explanations, architecture decisions, and
guidelines.

## Features

### Views - Region Grouping Functionality

The Views feature allows you to create custom groupings of regions based on
specific criteria. This enables organizing regions by themes, geography,
culture, or any other categorization that makes sense for your use case.

See [docs/VIEWS.md](docs/VIEWS.md) for detailed documentation. 

## Project Structure

This repository is organized as a monorepo containing several key components:

- **`backend/`**: This directory contains all the backend code responsible for
  handling the logic, database interactions, and API endpoints.
- **`frontend/`**: This directory houses the frontend application, which aims to
  provide the user interface for interacting with the service.
- **`api/`**: This directory is intended to contain API definitions, schemas,
  and related files to ensure standardized communication between the frontend
  and backend.
- **`deployment/`**: This directory is planned to include scripts for deploying
  the service, managing configurations, and orchestrating various components.
- **`docs/`**: This directory contains documentation for various features and
  functionality of the application.

## Future Considerations

In the future, this monorepo may be divided into several dedicated repositories
for each component. Therefore, please be very careful when making commits. It's
recommended to make commits in one component's directory at a time to facilitate
easier separation later.

### Enforcing Directory-Specific Commits

To ensure that commits are made in one component's directory at a time, we have
set up both pre-commit hooks and GitHub Actions.

#### Using Pre-Commit Hooks

1. Navigate to the repository root directory.
2. Run the following command to set the custom hooks directory:
   ```bash
   git config core.hooksPath .git-hooks
   ```

Now, every time you try to commit, the pre-commit hook will run and check if the
changes are restricted to a single directory. If not, the commit will be
aborted.

#### Using GitHub Actions

We also use GitHub Actions to enforce this rule. The action is defined
in `.github/workflows/dirs-check.yml`.

This action runs automatically on every push to the `main` branch and on every
pull request targeting the `main` branch. If the changes in the push or pull
request affect more than one component's directory, the action will fail,
preventing the changes from being merged.

By using these two methods, we aim to maintain a clean commit history and make
the future separation of components into their own repositories as smooth as
possible.

