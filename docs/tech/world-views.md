# World Views - Region Organization

This document describes the World Views feature that allows users to create 
custom regional organizations beyond the standard GADM (Global Administrative 
Areas) hierarchy.

## Terminology

| Term | Description | Example |
|------|-------------|---------|
| **Administrative Division** | Official geographic boundary from GADM | Germany, Bavaria, Munich |
| **World View** | A custom hierarchy for organizing regions | "Geographic Regions", "My Travel Map" |
| **Region** | A user-defined grouping within a World View | "Europe", "Baltic States", "Nordic Countries" |

### Code Mapping (Migration Complete)

The following table shows the completed migration from legacy naming to current naming:

| Concept | Database Table | TypeScript Type |
|---------|---------------|-----------------|
| Administrative Division | `administrative_divisions` | `AdministrativeDivision` |
| World View | `world_views` | `WorldView` |
| Region | `regions` | `Region` |
| Region Member | `region_members` | `RegionMember` |

### API Endpoints

| Resource | Path |
|----------|------|
| Administrative Divisions | `/api/divisions/*` |
| World Views | `/api/world-views` |
| Regions | `/api/world-views/:id/regions/*` |

## Overview

While GADM provides a standardized administrative hierarchy (Country → State → 
District), real-world use cases often require custom groupings. The World Views 
feature allows users to:

- Create custom World Views with their own regional organizations
- Combine multiple administrative divisions into logical regions
- Create nested hierarchies with subregions
- Define custom boundaries for partial regions
- Visualize and compute geometries for custom regions

For implementation details of the Create Subregions map tab (`assign`, `split`, `cut`), see `custom-subdivision-map-tools.md`.

---

## Core Concepts

### World View
A named collection of regions representing a custom way of organizing the world:
- "Geographic Regions" - continents, subcontinents, cultural regions
- "My Travel Map" - personal organization of visited areas
- "Sales Territories" - business regions

### Region
A node in the World View hierarchy that can contain:
- **Administrative Divisions** - direct references to GADM boundaries
- **Subregions** - nested regions for further organization

### Members
The contents of a region, which can be:
- **Administrative Divisions** - standard GADM boundaries
- **Subregions** - child regions in the hierarchy

---

## Features

### 1. Create and Manage World Views

Create custom World Views to organize regions your way.

**Example:**
```
World View: "Geographic Regions"
├── Europe
│   ├── Western Europe
│   │   ├── France
│   │   ├── Germany
│   │   └── Benelux
│   │       ├── Belgium
│   │       ├── Netherlands
│   │       └── Luxembourg
│   ├── Eastern Europe
│   │   ├── Poland
│   │   ├── Ukraine
│   │   └── Baltic States
│   │       ├── Estonia
│   │       ├── Latvia
│   │       └── Lithuania
│   └── Nordic Countries
│       ├── Sweden
│       ├── Norway
│       ├── Finland
│       ├── Denmark
│       └── Iceland
└── Asia
    ├── Central Asia
    │   ├── Kazakhstan
    │   └── ...
    └── ...
```

### 2. Add Administrative Divisions to Regions

Search for any GADM administrative division and add it to your regions.

**Options when adding:**
- **Add as simple member** - just adds the administrative division
- **Create as subregion** - creates a region container
- **Include children as subregions** - also adds all subdivisions

**Example:**
Adding "Germany" to "Central Europe":
- Simple member: Just adds Germany's boundary
- As subregion with children: Creates Germany region with all 16 Bundesländer

### 3. Select Specific Children

When adding an administrative division, choose which specific children to include.

**Example Use Case:**
Creating "Somaliland" - GADM only has "Somalia":
1. Search for "Somalia"
2. Check "Select specific children"
3. Choose only the 5 regions that make up Somaliland
4. Give it a custom name "Somaliland"

### 4. Custom Boundaries (Partial Regions)

Draw custom polygons to define boundaries that don't match GADM borders.

**Example Use Cases:**

**Florida Keys:**
- GADM has Monroe County and Miami-Dade County
- Florida Keys is only the island chain
- Draw a polygon around just the keys

**Crimea:**
- Disputed territory needing custom handling
- Draw boundary to match preferred delineation

### 5. Staging Area for Multi-Division Regions

Collect multiple administrative divisions before creating a region.

**Example:**
Creating "Kazakhstan" (spans Europe and Asia in GADM):
1. Search for "Kazakhstan"
2. Stage both European and Asian portions
3. Click "Create Region"
4. Both portions combine into one region

### 6. Flatten Subregions

Convert subregions back to simple administrative division members.

**Example:**
Before:
```
Germany
├── Bavaria (subregion)
├── Berlin (subregion)
└── ... 16 subregions
```

After flattening:
```
Germany
├── Bavaria (admin division)
├── Berlin (admin division)
└── ... 16 admin divisions
```

### 7. Expand to Subregions

Convert administrative division members to subregions (opposite of flatten).

**Example:**
Before:
```
Nordic Countries
├── Sweden (admin division)
├── Norway (admin division)
└── Finland (admin division)
```

After expanding:
```
Nordic Countries
├── Sweden (subregion)
├── Norway (subregion)
└── Finland (subregion)
```

### 8. Color Management

Each region has a color for map visualization.

**Features:**
- **Inherit parent color** - new subregions use parent's color
- **Propagate color** - apply a region's color to all descendants
- **Individual colors** - each region can have its own color

### 9. Drag-and-Drop Reorganization

Reorganize the hierarchy by dragging regions.

**Features:**
- Drag a region to another to make it a child
- Drag to "root" to make it top-level
- Visual feedback shows valid drop targets

### 10. Geometry Computation

Compute merged geometries for regions.

**Single Region Computation:**
- Click "Compute" on a specific region
- Uses SSE (Server-Sent Events) streaming for real-time progress (6-step pipeline)
- Computes bottom-up: recursively computes children without geometry first, then parent
- Pipeline: collect geometries → analyze → snap neighbors → union → clean holes/slivers → save
- "Skip snapping" checkbox (default: on) skips the expensive neighbor-snapping step for faster computation. Snapping adds shared boundary vertices but is O(n²) on child count — can be slow for continents
- Uses a dedicated `pool.connect()` client for all computation queries, ensuring `SET statement_timeout` applies to the correct connection (not a random pool connection)
- Generates TS hull for archipelagos, clears stale hull data for non-archipelagos
- JWT is passed as `token` query parameter since `EventSource` can't send Authorization headers

**World View-wide Computation:**
- "Compute All Regions" button (shown when no region is selected)
- Processes all regions in dependency order (deepest children first)
- Shows progress with current region name and percentage
- Can be cancelled mid-process

---

## Real-World Examples

### Example 1: European Regions for Travel Tracking

```
Europe
├── Baltic States
│   ├── Estonia
│   ├── Latvia
│   └── Lithuania
├── Balkans
│   ├── Albania
│   ├── Bosnia and Herzegovina
│   ├── Bulgaria
│   ├── Croatia
│   └── ...
├── Benelux
│   ├── Belgium
│   ├── Netherlands
│   └── Luxembourg
└── Nordic Countries
    ├── Denmark
    ├── Finland
    ├── Iceland
    ├── Norway
    └── Sweden
```

### Example 2: Russia's Federal Districts

Organize Russia by federal districts rather than all 85 subjects:

```
Russia
├── Central Federal District
│   ├── Moscow
│   ├── Moscow Oblast
│   └── ...
├── Northwestern Federal District
│   ├── Saint Petersburg
│   └── ...
├── Southern Federal District
├── Volga Federal District
├── Ural Federal District
├── Siberian Federal District
└── Far Eastern Federal District
```

### Example 3: Transcontinental Countries

Handle countries spanning multiple continents:

**Kazakhstan:**
- Small part in Europe, majority in Asia
- Stage both GADM portions, create unified region

**Turkey:**
- Split into European Turkey and Asian Turkey
- Or keep unified in one region

**Russia:**
- European Russia in "Europe"
- Asian Russia in "Asia"
- Or keep unified

---

## API Endpoints

### World Views
- `GET /api/world-views` - List all world views
- `POST /api/world-views` - Create world view
- `PUT /api/world-views/:worldViewId` - Update world view
- `DELETE /api/world-views/:worldViewId` - Delete world view

### Regions
- `GET /api/world-views/:worldViewId/regions` - List regions in world view
- `GET /api/world-views/:worldViewId/regions/root` - List root regions
- `GET /api/world-views/:worldViewId/regions/search` - Search regions
- `GET /api/world-views/:worldViewId/regions/leaf` - List leaf regions
- `POST /api/world-views/:worldViewId/regions` - Create region
- `PUT /api/world-views/regions/:regionId` - Update region
- `DELETE /api/world-views/regions/:regionId` - Delete region

### Region Members
- `GET /api/world-views/regions/:regionId/members` - List region members
- `GET /api/world-views/regions/:regionId/members/geometries` - Member geometries (custom-aware)
- `POST /api/world-views/regions/:regionId/members` - Add members
- `DELETE /api/world-views/regions/:regionId/members` - Remove members
- `POST /api/world-views/regions/:regionId/members/:divisionId/add-children` - Add children

### Operations
- `POST /api/world-views/regions/:parentRegionId/flatten/:subregionId` - Flatten subregion
- `POST /api/world-views/regions/:regionId/expand` - Expand to subregions

### Geometry
- `GET /api/world-views/regions/:regionId/geometry` - Get region geometry
- `PUT /api/world-views/regions/:regionId/geometry` - Set custom geometry
- `POST /api/world-views/regions/:regionId/geometry/compute` - Compute single region
- `GET /api/world-views/regions/:regionId/geometry/compute-stream` - Compute single region with SSE progress
- `POST /api/world-views/:worldViewId/compute-geometries` - Compute all geometries
- `GET /api/world-views/:worldViewId/compute-geometries/status` - Get computation status
- `POST /api/world-views/:worldViewId/compute-geometries/cancel` - Cancel computation
- `GET /api/world-views/:worldViewId/display-geometry-status` - Display geometry status
- `POST /api/world-views/:worldViewId/regenerate-display-geometries` - Regenerate display geometries
- `POST /api/world-views/regions/:regionId/hull/preview` - Preview hull geometry
- `POST /api/world-views/regions/:regionId/hull/save` - Save hull geometry

---

## Tips and Best Practices

1. **Start with major regions** - Create continents/major areas first, then subdivide

2. **Use color inheritance** - Let subregions inherit parent colors for consistency

3. **Compute bottom-up** - System automatically processes children first

4. **Custom boundaries for edge cases** - Use draw tool for territories that don't match GADM

5. **Staging for complex regions** - Use staging area when combining multiple admin divisions

6. **Flatten when simplifying** - If you don't need subregion structure, flatten to reduce complexity

7. **Force recompute after changes** - After modifying members, recompute geometry to update the map
