# API Documentation and Definitions

## Overview

This directory contains API definitions, schemas, and related files for the Region Tracker service. It serves as the
central location for all API-related resources, ensuring standardized communication between the frontend and backend
components.

## Structure

- [**`.gitignore`**](./.gitignore): Configuration file for specifying untracked files to ignore.
- [**`.spectral.yaml`**](./.spectral.yaml): Configuration file for Spectral, defining custom rules or extending from
  existing sets for linting the API specifications.
- [**`README.md`**](./README.md): This file, providing documentation and guidelines for managing API specifications.
- [**`api.yaml`**](./api.yaml): Contains the OpenAPI definitions and schemas for the Region Tracker service. It's the
  source of truth for API structure and details.
- [**`package.json`**](./package.json): Node.js package configuration, including scripts and dependencies for tooling,
  like Spectral for API linting.

## Guidelines

- **Consistency:** Follow established naming conventions and directory structure for consistency across the project.
- **Documentation:** Keep the API documentation and domain model up-to-date with the latest changes. Any new endpoints
  or domain changes should be properly documented and communicated.
- **Linting:** Use Spectral to lint your API specifications. Adhere to the rules defined in `.spectral.yaml` to maintain
  a high quality, standard-compliant API description.

## API Linting with Spectral

We use Spectral to enforce quality and standards in our API definitions. Spectral lints our OpenAPI documents to ensure
they are up to the standards and catch any potential issues early.

### Running Spectral

- **Locally:** Run `npm run lint` within this directory to lint the `api.yaml` file. Make sure you have all dependencies 
  installed.
- **GitHub Actions:** The repository includes a GitHub Action workflow named "Spectral API Check" that automatically
  runs Spectral against pull requests and pushes to the `main` branch. It helps catch issues early in the development
  process.

### Rules and Configuration

- Our Spectral rules are defined in `.spectral.yaml`. It currently extends the standard OpenAPI rules provided by
  Spectral but can be customized further as needed.
- We treat all Spectral warnings as errors to ensure strict compliance with the API standards. This is configured in
  `package.json` under the `scripts` section with `"lint": "spectral lint api.yaml --fail-severity warn"`.

## Contribution

When contributing to the API specifications:

- **Review existing documents:** Familiarize yourself with the current `api.yaml` and related documentation to
  understand the existing structure and standards.
- **Discuss major changes:** For significant modifications or additions, [discuss](https://github.com/OhmSpectator/track-your-regions/discussions)
  with the team to ensure alignment with the overall project direction and architecture.
- **Follow the workflow:** Make use of the established GitHub Actions and linting processes to validate your changes.
