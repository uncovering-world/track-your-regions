For an overview of Domain-Driven Design (DDD) and key terms used in this document, please refer to the [DDD Overview](ddd-overview.md)

## Ubiquitous Language

- **User**: A person who uses the application to explore or track visited 
  regions and experiences.
- **Visitor**: A user who has not registered an account.
- **Registered User**: A user who has registered an account.
- **Administrative Division**: A specific administrative division, representing
  the formal geographic areas from GADM (Global Administrative Areas). The 
  administrative divisions are structured hierarchically, meaning an 
  administrative division can contain sub-divisions (e.g., Country → State → County).
- **World View**: A way of organizing administrative divisions into meaningful
  regions. The default World View is "GADM" which reflects the standard 
  administrative hierarchy. Users can create custom World Views to organize
  regions by cultural, geographical, historical, or personal criteria.
- **Region**: A user-defined grouping of Administrative Divisions or other 
  Regions within a World View. Regions are structured hierarchically, meaning
  a region can contain sub-regions. Examples: "Europe", "Baltic States", 
  "Nordic Countries".
- **Experience**: An activity or sight that can be completed or seen in a
  region.
- **Cultural Context**: A design principle applied across experience descriptions,
  not a standalone entity. Cultural context means providing historical, social,
  and environmental background for experiences — helping travelers understand
  rather than judge. See [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md).

## Entities

### User

- **Description**: A person who uses the application. Can be a Registered User or a Visitor.
- **Attributes**:
  - `ID`: Unique identifier (For Registered Users)
  - `Username`: User's chosen name (For Registered Users, optional for Visitors)
  - `Role`: User's role in the application (`user`, `curator`, `admin`)

### AdministrativeDivision

- **Description**: A specific administrative division from GADM, representing 
  the formal geographic areas (countries, states, provinces, counties, etc.).
- **Attributes**:
  - `ID`: Unique identifier
  - `Name`: Name of the administrative division
  - `ParentDivisionID`: ID of the parent division, if any
  - `HasSubdivisions`: Boolean flag indicating if this division has subdivisions
  - `Geometry`: Geographic boundary (MultiPolygon)

### WorldView

- **Description**: A way of organizing administrative divisions into meaningful
  regions. Represents a custom hierarchy or perspective for viewing regions.
- **Attributes**:
  - `ID`: Unique identifier
  - `Name`: Name of the world view (e.g., "Geographic Regions", "Travel Map")
  - `Description`: Optional description of the world view
  - `IsDefault`: Boolean flag indicating if this is the default GADM view
  - `IsActive`: Boolean flag indicating if this view is active

### Region

- **Description**: A user-defined grouping of Administrative Divisions or other
  Regions within a World View. Enables custom organization beyond GADM hierarchy.
- **Attributes**:
  - `ID`: Unique identifier
  - `WorldViewID`: ID of the world view this region belongs to
  - `Name`: Name of the region (e.g., "Baltic States", "Nordic Countries")
  - `Description`: Optional description of the region
  - `ParentRegionID`: ID of the parent region, if any
  - `Color`: Display color for map visualization
  - `HasSubregions`: Boolean flag indicating if this region has subregions
  - `Geometry`: Cached merged geometry (computed from members)
  - `IsCustomBoundary`: Boolean flag if geometry is manually drawn

### Experience

- **Description**: Anything a user can engage with in connection with a region — must be
  trackable. May act as a venue (holding treasures, e.g. a museum with artworks) or stand
  alone (e.g. a UNESCO site, a monument). See [Experiences System](experiences.md) and
  [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md) for the full model.
- **Attributes**:
  - `ID`: Unique identifier
  - `SourceID`: ID of the data source (UNESCO, etc.)
  - `ExternalID`: ID from the original data source
  - `Name`: Name of the experience
  - `NameLocal`: Multilingual names (JSONB)
  - `Description`: Full description
  - `ShortDescription`: Brief description for display
  - `Category`: Per-source classification (e.g., 'cultural', 'natural', 'mixed' for UNESCO; 'art', 'history' for museums)
  - `Tags`: Additional classification tags (JSONB)
  - `Location`: Geographic point (PostGIS Point, SRID 4326)
  - `Boundary`: Optional boundary geometry (PostGIS MultiPolygon)
  - `CountryCodes`: ISO country codes array
  - `CountryNames`: Country names array
  - `ImageURL`: URL to representative image
  - `Metadata`: Source-specific data (JSONB)

### ExperienceSource

- **Description**: A data source for experiences (e.g., UNESCO World Heritage Sites,
  National Parks). Enables extensibility for multiple experience providers.
- **Attributes**:
  - `ID`: Unique identifier
  - `Name`: Source name (unique)
  - `Description`: Human-readable description
  - `APIEndpoint`: External API URL for syncing
  - `APIConfig`: Configuration for sync process (JSONB)
  - `IsActive`: Whether the source is enabled
  - `LastSyncAt`: Timestamp of last sync
  - `LastSyncStatus`: 'success', 'partial', or 'failed'

### ExperienceRegion

- **Description**: Junction table linking experiences to containing regions.
  Computed automatically via spatial containment queries and propagated to
  ancestor regions in the hierarchy.
- **Attributes**:
  - `ExperienceID`: ID of the experience
  - `RegionID`: ID of the containing region
  - `AssignmentType`: 'auto' (computed) or 'manual' (user-specified)

### ExperienceLocation

- **Description**: A physical location belonging to an experience. An experience
  may have zero locations (region-associated but not place-bound, e.g. books),
  one location (a single point on the map), or many (serial nominations,
  distributed sites). Each location is independently trackable.
- **Attributes**:
  - `ID`: Unique identifier
  - `ExperienceID`: Parent experience
  - `Name`: Optional component/location name
  - `ExternalRef`: Source-specific component ID
  - `Ordinal`: Display order within the experience
  - `Location`: Geographic point (PostGIS Point, SRID 4326)

### ExperienceContent (Treasure)

- **Description**: An independently trackable treasure inside a venue experience
  (artwork in a museum, species in a park). Treasures have a many-to-many
  relationship with venues — the same species can be found in multiple zoos.
  Iconic treasures are called **highlights** and shown with a badge.
  Currently used for venue significance computation; region-scoped treasure
  browsing is planned. DB table: `experience_contents`.
  See [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md).
- **Attributes**:
  - `ID`: Unique identifier
  - `ExperienceID`: Parent experience
  - `ExternalID`: Source identifier (e.g., Wikidata QID)
  - `Name`: Treasure title
  - `ContentType`: Classification (painting, sculpture, etc.)
  - `Artist`: Optional creator name
  - `Year`: Optional creation year

### CuratorAssignment

- **Description**: Scoped permission entry that allows curation.
- **Attributes**:
  - `UserID`: Curator user ID
  - `ScopeType`: `global` | `region` | `source`
  - `RegionID`: Present when scope is region-scoped
  - `SourceID`: Present when scope is source-scoped
  - `AssignedBy`: Admin who granted scope

### ExperienceRejection

- **Description**: Region-scoped suppression of an experience from public queries.
- **Attributes**:
  - `ExperienceID`: Rejected experience
  - `RegionID`: Region where it is rejected
  - `RejectedBy`: Curator/admin who rejected it
  - `Reason`: Optional text reason

### AdminDivisionReport

- **Description**: Represents a user's relationship with an administrative
  division. Can be unvisited, planned or visited.
- **Attributes**:
  - `UserID`: ID of the user
  - `AdminDivisionID`: ID of the administrative division
  - `Status`: Unvisited/Planned/Visited
  - `VisitDates`: Optional list of all visit dates
  - `NumberOfVisits`: Total number of visits

### RegionReport

- **Description**: Represents a user's relationship with a region. Can be
  unvisited, planned or visited.
- **Attributes**:
  - `UserID`: ID of the user
  - `RegionID`: ID of the region
  - `Status`: Unvisited/Planned/Visited
  - `VisitDates`: Optional list of all visit dates
  - `NumberOfVisits`: Total number of visits

### ExperienceReport

- **Description**: Represents a user's relationship with an experience. Can be either planned or completed.
- **Attributes**:
  - `UserID`: ID of the user
  - `ExperienceID`: ID of the experience
  - `RegionID`: ID of the region where the experience is located
  - `Status`: Planned/Completed
  - `CompletionDates`: Optional list of all completion dates
  - `NumberOfCompletions`: Total number of completions

## Aggregates

### RegionDescription

- **Description**: Represents a specific region along with the experiences available in that region.
- **Consists of**:
  - `Region`
  - List of `Experience`
- **Attributes**:
  - `RegionID`: ID of the associated region
  - `Experiences`: List of experiences available in the region

### CulturalContext

> **Note:** Cultural context is a design principle applied across experience descriptions, not a standalone entity. The original plan for a separate `CulturalContext` aggregate has been superseded — context is woven into experience metadata, regional profiles, and locals' perspectives instead. See [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md).

### UserJourney

- **Description**: A collection of regions and experiences that a user has interacted with or plans to interact with.
- **Consists of**:
  - List of `RegionReport`
  - List of `ExperienceReport`
- **Attributes**:
  - `Visibility`: Public/Private (Determines if the journey can be seen by others)
  - `StartDate`: Optional start date of the journey
  - `EndDate`: Optional end date of the journey
  - `Status`: Planned/Ongoing/Completed

## Domain Events

### AdminDivisionInteracted

- **Description**: Triggered when a user marks an administrative division as
  visited or planned.
- **Attributes**:
  - `UserID`
  - `AdminDivisionID`
- **Effect**: Triggers a check and potential update of the parent entity's
  visit status.

### RegionInteracted

- **Description**: Triggered when a user marks a region as visited or planned.
- **Attributes**:
  - `UserID`
  - `RegionID`
- **Effect**: Triggers a check and potential update of the parent entity's
  visit status.

### ExperienceInteracted

- **Description**: Triggered when a user marks an experience as completed or planned.
- **Attributes**:
  - `UserID`
  - `ExperienceID`
  - `RegionID`
