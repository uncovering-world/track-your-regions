# Domain Model for Region and Experience Tracking Service

For an overview of Domain-Driven Design (DDD) and key terms used in this
document, please refer to the [DDD Overview](./ddd_overview.md).

## Ubiquitous Language

- **User**: A person who uses the application to track visited regions and
  experiences.
- **Region**: A geographical area that can be visited by a user. Regions are
  structured hierarchically, meaning a region can contain sub-regions.
- **Experience**: An activity or sight that can be completed or seen in a
  region.
- **Visited Region**: A region that has been visited by a user.
- **Completed Experience**: An experience that has been completed by a user in a
  specific region.

## Entities

### User

- **Description**: A person who uses the application. Can be a Registered User or a Visitor.
- **Attributes**:
  - `ID`: Unique identifier (For Registered Users)
  - `Username`: User's chosen name (For Registered Users, optional for Visitors)
  - `Role`: User's role in the application (Registered/Visitor)

### Region

- **Description**: A geographical area that can be visited. Regions are
  structured hierarchically.
- **Attributes**:
  - `ID`: Unique identifier
  - `Name`: Name of the region
  - `ParentRegionID`: ID of the parent region, if any (this establishes the hierarchy)
  - `HasSubregions`: Boolean flag indicating if this region has subregions

### Experience

- **Description**: An activity or sight that can be completed or seen in a
  region.
- **Attributes**:
  - `ID`: Unique identifier
  - `Name`: Name of the experience

## Value Objects

### VisitedRegion

- **Description**: Represents a region visited by a user. Includes tracking of multiple visits.
- **Attributes**:
  - `UserID`: ID of the user who visited the region
  - `RegionID`: ID of the visited region
  - `FirstVisitDate`: Date of the first visit
  - `LastVisitDate`: Date of the most recent visit
  - `NumberOfVisits`: Total number of visits
  - `VisitDates`: Optional list of all visit dates (including first and last)

### CompletedExperience

- **Description**: Represents an experience completed by a user in a specific region. Includes tracking of multiple completions.
- **Attributes**:
  - `UserID`: ID of the user who completed the experience
  - `ExperienceID`: ID of the completed experience
  - `RegionID`: ID of the region where the experience was completed
  - `FirstCompletionDate`: Date of the first completion
  - `LastCompletionDate`: Date of the most recent completion
  - `NumberOfCompletions`: Total number of times the experience has been completed
  - `CompletionDates`: Optional list of all completion dates (including first and last)

## Aggregates

### UserJourney

- **Description**: A collection of regions visited and experiences completed by a user.
- **Consists of**:
  - List of `VisitedRegion`
  - List of `CompletedExperience`
- **Attributes**:
  - `Visibility`: Public/Private (Determines if the journey can be seen by Visitors)

## Domain Events

### RegionVisited

- **Description**: Triggered when a user marks a region as visited.
- **Attributes**:
  - `UserID`
  - `RegionID`

### ExperienceCompleted

- **Description**: Triggered when a user marks an experience as completed.
- **Attributes**:
  - `UserID`
  - `ExperienceID`
  - `RegionID`
