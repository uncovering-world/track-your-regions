# State Management Architecture

## Current State Analysis

### Problem Statement
The Custom Subdivision Dialog stores state (subdivision groups, image overlays, AI suggestions) in **localStorage**, but the actual divisions are stored in the **database**. This creates synchronization issues:

1. When divisions are removed from DB, localStorage still references them
2. Image overlay settings are lost when localStorage is cleared
3. State can become stale if changes are made elsewhere
4. No way to share state across devices/users

### Current State Storage

| Data | Current Storage | Should Be |
|------|----------------|-----------|
| Region members (divisions) | Database | Database ✓ |
| Subdivision groups | localStorage | Database |
| Group assignments | localStorage | Database |
| Image overlay settings | localStorage | Database |
| AI suggestions (temporary) | localStorage | Keep in localStorage (temporary/cache) |
| AI usage stats | localStorage | Keep in localStorage (analytics) |

## Recommended Architecture

### 1. Database Schema Updates

Add tables to store persistent UI state:

```sql
-- Subdivision groups for a region
CREATE TABLE region_subdivision_groups (
  id SERIAL PRIMARY KEY,
  region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(7), -- hex color
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Group assignments (which member belongs to which group)
CREATE TABLE region_member_group_assignments (
  id SERIAL PRIMARY KEY,
  region_member_id INTEGER REFERENCES region_members(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES region_subdivision_groups(id) ON DELETE CASCADE,
  UNIQUE(region_member_id, group_id)
);

-- Image overlay settings per region
CREATE TABLE region_image_overlays (
  id SERIAL PRIMARY KEY,
  region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  image_data TEXT, -- base64 or URL
  image_name VARCHAR(255),
  coordinates JSONB, -- [[lng,lat], ...]
  opacity REAL DEFAULT 0.7,
  image_width INTEGER,
  image_height INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(region_id) -- one overlay per region
);
```

### 2. State Management Patterns

#### Option A: React Query (Current Approach - Enhanced)
Keep using React Query for server state, but properly invalidate/refetch when data changes.

**Pros:**
- Already in use
- Good caching
- Automatic refetching

**Cons:**
- Still need to manage sync between local and server state

#### Option B: Zustand (Recommended for Complex Local State)
Use Zustand for UI state that needs to persist but doesn't need real-time sync.

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SubdivisionDialogStore {
  // Per-region state (keyed by regionId)
  groupsByRegion: Record<number, SubdivisionGroup[]>;
  imageOverlaysByRegion: Record<number, ImageOverlaySettings | null>;
  
  // Actions
  setGroups: (regionId: number, groups: SubdivisionGroup[]) => void;
  setImageOverlay: (regionId: number, settings: ImageOverlaySettings | null) => void;
  
  // Sync with server
  syncFromServer: (regionId: number) => Promise<void>;
  syncToServer: (regionId: number) => Promise<void>;
}
```

**Pros:**
- Simple, lightweight
- Built-in persistence middleware
- Easy to debug with devtools

#### Option C: Redux Toolkit (For Large-Scale Apps)
If the app grows significantly, Redux Toolkit provides more structure.

**Pros:**
- Time-travel debugging
- Predictable state updates
- Large ecosystem

**Cons:**
- More boilerplate
- Overkill for current app size

### 3. Recommended Immediate Fixes

1. **Validate localStorage state against DB on load:** ✅ IMPLEMENTED
   - When dialog opens, fetch current DB members
   - Filter out any stored divisions that no longer exist in DB
   - Add any new DB members that aren't in stored state to unassigned list
   - Update stored members with current DB data (e.g., memberRowId)
   
   ```typescript
   // Implemented in CustomSubdivisionDialog/index.tsx
   const validateStoredState = (stored, dbMembers) => {
     // 1. Filter out stale members
     const validUnassigned = stored.unassignedDivisions
       .filter(d => memberExistsInDb(d, dbMembers))
       .map(d => updateMemberFromDb(d, dbMembers));
     
     // 2. Find new DB members not in stored state
     const newMembers = dbMembers.filter(db => !memberExistsInStored(db, stored));
     
     // 3. Combine: keep existing valid + add new
     return { unassignedDivisions: [...validUnassigned, ...newMembers], ... };
   };
   ```

2. **Store image overlay in DB** (high priority - user work shouldn't be lost)

3. **Store subdivision groups in DB** (medium priority - allows persistence across sessions)

### 4. Best Practices

1. **Single Source of Truth**: DB is the source of truth for what exists. localStorage/Zustand is for UI preferences.

2. **Optimistic Updates with Rollback**: Update UI immediately, sync to server, rollback on failure.

3. **Stale-While-Revalidate**: Show cached data immediately, refetch in background.

4. **Clear Cache on Mutation**: When divisions are added/removed, invalidate related localStorage.

5. **Unique Keys**: Always use `memberRowId` for React keys when dealing with cut divisions.

## Implementation Plan

### Phase 1: Immediate Fixes (This Session) ✅ COMPLETED
- [x] Validate localStorage state against current DB members
- [x] Clear stale entries from localStorage when loading
- [x] Add new DB members to unassigned list if not in stored state

### Phase 2: Short-term (Next Sprint)
- [ ] Add `region_image_overlays` table
- [ ] Add API endpoints for image overlay CRUD
- [ ] Migrate image overlay storage to DB

### Phase 3: Medium-term
- [ ] Add subdivision groups tables
- [ ] Migrate group assignments to DB
- [ ] Consider Zustand for remaining UI state

### Phase 4: Long-term
- [ ] Evaluate if Redux Toolkit is needed as app grows
- [ ] Add collaborative editing support if needed
