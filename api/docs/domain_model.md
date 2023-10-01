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

## Entities

### User

- **Description**: A person who uses the application. Can be a Registered User or a Visitor.
- **Attributes**:
  - `ID`: Unique identifier (For Registered Users)
  - `Username`: User's chosen name (For Registered Users, optional for Visitors)
  - `Role`: User's role in the application (Registered/Visitor)

### Region

- **Description**: A geographical area that can be visited.
- **Attributes**:
  - `ID`: Unique identifier
  - `Name`: Name of the region
  - `ParentRegionID`: ID of the parent region, if any
  - `HasSubregions`: Boolean flag indicating if this region has subregions

### Experience

- **Description**: An activity or sight that can be completed or seen in a region.
- **Attributes**:
  - `ID`: Unique identifier
  - `Name`: Name of the experience

### RegionReport

- **Description**: Represents a user's relationship with a region. Can be either planned or visited.
- **Attributes**:
  - `UserID`: ID of the user
  - `RegionID`: ID of the region
  - `Status`: Planned/Visited
  - `VisitDates`: Optional list of all visit dates
  - `NumberOfVisits`: Total number of visits
  - `

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

### RegionInteracted

- **Description**: Triggered when a user marks a region as visited or planned.
- **Attributes**:
  - `UserID`
  - `RegionID`

### ExperienceInteracted

- **Description**: Triggered when a user marks an experience as completed or planned.
- **Attributes**:
  - `UserID`
  - `ExperienceID`
  - `RegionID`
