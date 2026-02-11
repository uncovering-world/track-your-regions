# General User Stories

> **Implementation Status:** These user stories describe the product vision. Items marked with ✅ are implemented, others are planned. The core experiences system (browsing, tracking, curation) is implemented — see [`EXPERIENCES-OVERVIEW.md`](EXPERIENCES-OVERVIEW.md) for the full vision.

---

### User Registration ✅
- **As a**: Visitor
- **I want**: To register for the Region Tracking service
- **So that**: I can start tracking the regions I visit and the experiences I complete

### Authenticate ✅
- **As an**: Existing User
- **I want**: To authenticate using JWT tokens
- **So that**: I can use authorized endpoints securely

### OAuth Authentication ✅ (Google only, Apple untested)
- **As a**: User
- **I want**: To authenticate using OAuth (e.g., Google, Apple)
- **So that**: I can quickly and securely access the service without creating a new password

### Add Visited Region ✅
- **As an**: Existing User
- **I want**: To mark a region as visited
- **So that**: It appears in my user journey

### Remove Visited Region ✅
- **As an**: Existing User
- **I want**: To remove a region from my visited list
- **So that**: I can correct it if marked by mistake

### List My Visited Regions ✅
- **As an**: Existing User
- **I want**: To see a list of all regions I've visited
- **So that**: I can recall my travel history  

### Create a Journey  
- **As an**: Existing User  
- **I want**: To create a journey consisting of regions and experiences  
- **So that**: I can have a curated list of places I want to visit and things I want to do  

### Follow Other Users  
- **As an**: Existing User  
- **I want**: To follow other users  
- **So that**: I can get updates on their travels and experiences  

### List Another User's Visited Regions  
- **As an**: Existing User  
- **I want**: To see the regions visited by another user  
- **So that**: I can get travel inspiration  

### Browse Experiences ✅
- **As an**: Existing User
- **I want**: To see a list of experiences available in a specific region
- **So that**: I can plan my visit

### Mark Experience as Completed ✅
- **As an**: Existing User
- **I want**: To mark an experience as completed in a specific region
- **So that**: I can track what I've done

### Undo Completed Experience ✅
- **As an**: Existing User
- **I want**: To mark a previously completed experience as undone
- **So that**: I can correct it if marked by mistake

### List My Completed Experiences ✅
- **As an**: Existing User
- **I want**: To see a list of all experiences I've completed
- **So that**: I can recall my experiences

### List Another User's Completed Experiences  
- **As an**: Existing User  
- **I want**: To see the experiences completed by another user  
- **So that**: I can get ideas for my own journey  

### Search Experiences  
- **As an**: Existing User  
- **I want**: To search for experiences by name or tags  
- **So that**: I can find specific activities more easily

### Rate and Review Experiences  
- **As an**: Existing User  
- **I want**: To rate and review experiences I've completed  
- **So that**: Other users can benefit from my insights

### Export My Overall Data  
- **As an**: Existing User  
- **I want**: To export all my visited regions, completed experiences, and journey tracks to a generic format (e.g., JSON, CSV)  
- **So that**: I can have a backup of my important statistics and use the data in other tools

### On-Site Notifications for Friends' Updates  
- **As an**: Existing User  
- **I want**: To receive light on-site notifications about new regions visited and experiences completed by users I follow  
- **So that**: I can stay updated on my friends' activities and feel motivated  

### Monthly Digest for Regions and Experiences  
- **As an**: Existing User  
- **I want**: To receive a monthly email digest summarizing updates on regions and new experiences added  
- **So that**: I can stay informed and plan my future journeys  

### Advanced Privacy Settings  
- **As an**: Existing User  
- **I want**: To manage who can see my overall journey, as well as have the option to hide specific visited regions or completed experiences  
- **So that**: I can have granular control over my privacy  
