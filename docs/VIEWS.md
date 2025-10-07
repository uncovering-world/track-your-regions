# Views - Region Grouping Functionality

## Overview

The Views feature provides a way to group and organize regions based on specific criteria. Views allow users to create custom collections of regions that can be used for filtering, analysis, or presenting regions in a meaningful way.

## Database Schema

### Tables

#### `views`
Stores view definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER (PK) | Unique identifier for the view |
| `name` | VARCHAR(255) | Name of the view |
| `description` | TEXT | Optional description of the view |
| `hierarchy_id` | INTEGER (FK) | Foreign key to `hierarchy_names` table |
| `is_active` | BOOLEAN | Whether the view is active and visible |

#### `view_region_mapping`
Associates regions with views.

| Column | Type | Description |
|--------|------|-------------|
| `view_id` | INTEGER (PK, FK) | Foreign key to `views` table |
| `region_id` | INTEGER (PK) | Region ID within the hierarchy |
| `hierarchy_id` | INTEGER (PK, FK) | Foreign key to `hierarchy` table |

## API Endpoints

### GET `/api/views`
Retrieve all views for a hierarchy.

### POST `/api/views`
Create a new view.

### GET `/api/views/{viewId}`
Retrieve a specific view by ID.

### PUT `/api/views/{viewId}`
Update a view.

### DELETE `/api/views/{viewId}`
Delete a view and all its region associations.

### GET `/api/views/{viewId}/regions`
Get all regions in a view.

### POST `/api/views/{viewId}/regions`
Add regions to a view.

### DELETE `/api/views/{viewId}/regions`
Remove regions from a view.

## Frontend Integration

### Components

#### `ViewSelector`
A dropdown component that allows users to select a view to filter the list of regions.

**Location:** `frontend/src/components/ViewSelector.jsx`

## Database Migration

To apply the database migrations and create the views tables:

```bash
cd backend
npm run migrate
```

To rollback the migration:

```bash
cd backend
npm run migrate:undo
```
