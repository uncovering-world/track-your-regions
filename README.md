# Region Tracker

## Introduction

The goal of Region Tracker is to provide a web service that helps users keep
track of regions they have visited and experiences they have had. The platform
aims to offer a comprehensive, hierarchically-structured list of predefined
regions and associated experiences, making travel tracking both detailed and
enriching.

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

## Future Considerations

In the future, this monorepo may be divided into several dedicated repositories
for each component. Therefore, please be very careful when making commits. It's
recommended to make commits in one component's directory at a time to facilitate
easier separation later.
