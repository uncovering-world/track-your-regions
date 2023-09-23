# API Documentation and Definitions

## Overview

This directory is intended to contain API definitions, schemas, and related
files. It serves as the central location for all API-related resources, ensuring
standardized communication between the frontend and backend components of the
Region Tracker service.

## Domain Model

In addition to API definitions and schemas, this directory also contains the
[`domain_model.md`](docs/domain_model.md) file. This document serves as the 
foundational blueprint for the project, capturing the essential elements and
relationships in the domain. It is based on Domain-Driven Design (DDD) 
principles and provides a shared understanding between all team members and 
stakeholders.

## Structure

This directory is organized as follows:

- [**`docs/`**](docs): This directory contains the documentation that describes
  the domain model and API definitions.
- [**`api.yaml`**](./api.yaml): This file contains the API definitions and
  schemas for the Region Tracker service. Later on, this file may be split into
  separate files for different roles (e.g. user, admin, etc.) or components (
  e.g. frontend, backend, etc.).

## Guidelines

- Always keep the API documentation and domain model up-to-date with the latest
  changes.
- Ensure that any new endpoints or domain changes are properly documented and
  tested.
- Follow the established naming conventions for consistency.

