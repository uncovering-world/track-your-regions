# Regions Listing User Stories

> **Implementation Status:** These features are core to the application and are fully implemented.

This page focuses on the functionality of listing and exploring regions within our application. These features are central to providing users with the ability to discover and navigate through various geographical areas. Importantly, these capabilities are available not only for registered users but also for those who haven't registered yet.

## User Stories

### Browse Regions ✅
- **As a**: User
- **I want**: To see a list of all regions or subregions of a given region.
- **So that**: I can explore places to visit.

*Implemented via World Views hierarchy navigation and interactive map.*

### Search Regions ✅
- **As a**: User
- **I want**: To search for regions by name.
- **So that**: I can find specific places more easily.

*Implemented with fuzzy search using PostgreSQL pg_trgm extension.*
