# Mobile App Planning

> **Implementation Status:** This is a planning document for future mobile development. No mobile apps exist yet. The web app must be feature-complete before starting mobile development.

This document outlines the plan for adding native iOS and Android apps to Track Your Regions.

## Architecture Decision

**Approach:** Separate repositories for native apps, shared API contract via OpenAPI.

### Alternative Approaches Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Native (Swift/Kotlin)** | Best performance, native UX, full platform APIs | Separate codebases, higher dev cost | ✅ Recommended for best UX |
| **React Native** | Share some code with web, large community | Performance gaps, native bridge complexity | Consider for MVP |
| **Flutter** | Single codebase, great performance | Dart learning curve, less native feel | Good alternative |
| **Capacitor/Ionic** | Wrap existing React web app | Not truly native, limited offline | Not recommended for map-heavy app |

**Current recommendation:** Start with React Native as it allows code sharing with the React web app, then evaluate native development for performance-critical features (maps, offline support).

```
track-your-regions/          # Monorepo (current)
├── backend/
├── frontend/                # Web
├── db/
└── docs/

track-your-regions-ios/      # Future: separate repo
track-your-regions-android/  # Future: separate repo
```

**Rationale:**
- Native apps (Swift/Kotlin) use completely different tooling
- App store release cycles are independent from web
- No code can be shared directly between TypeScript and Swift/Kotlin
- API contracts are shared via OpenAPI specification

## Current API Response Patterns

### Error Responses (Consistent)

All errors follow this pattern:
```json
{
  "error": "Error message here",
  "details": { ... }  // Optional, used for validation errors
}
```

HTTP status codes:
- `400` - Bad request (validation, missing data)
- `404` - Resource not found
- `409` - Conflict (e.g., operation already in progress)
- `500` - Internal server error
- `503` - Service unavailable (database down)

### Success Responses (Currently Inconsistent)

Current patterns vary:
- Raw arrays: `[item1, item2, ...]`
- Objects with metadata: `{ running: true, progress: 50, ... }`
- GeoJSON features: `{ type: "Feature", properties: {...}, geometry: {...} }`

## Pre-Mobile Preparation Tasks

### Phase 1: API Consistency (Before Mobile Development)

**Task 1: Standardize Success Response Envelope**

Wrap all success responses in a consistent envelope:
```typescript
// Standard success response
interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    // ... pagination, etc.
  };
}

// Example
res.json({ data: divisions, meta: { total: divisions.length } });
```

**Exception:** GeoJSON responses can remain unwrapped (they follow GeoJSON spec).

**Task 2: Add OpenAPI Generation**

Install and configure OpenAPI spec generation:
```bash
npm install @asteasolutions/zod-to-openapi
# or
npm install tsoa
```

Generate `openapi.json` from existing Zod schemas and route definitions.

**Task 3: Create Response Type Definitions**

Define shared response types in `backend/src/types/api.ts`:
```typescript
export interface ApiError {
  error: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiMeta {
  total?: number;
  page?: number;
  pageSize?: number;
}

// Pagination wrapper
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}
```

**Task 4: Document All Endpoints**

Create API documentation with:
- Request/response schemas
- Authentication requirements
- Rate limiting info
- Example requests/responses

### Phase 2: Mobile Repository Setup

**Task 5: Create iOS Repository**

```
track-your-regions-ios/
├── TrackYourRegions/
│   ├── API/              # Generated from OpenAPI
│   ├── Models/           # Generated from OpenAPI
│   ├── Views/
│   ├── ViewModels/
│   └── Services/
├── TrackYourRegionsTests/
└── scripts/
    └── generate-api.sh   # Regenerate from OpenAPI
```

**Task 6: Create Android Repository**

```
track-your-regions-android/
├── app/src/main/
│   ├── java/.../api/     # Generated from OpenAPI
│   ├── java/.../models/  # Generated from OpenAPI
│   ├── java/.../ui/
│   └── java/.../data/
└── scripts/
    └── generate-api.sh   # Regenerate from OpenAPI
```

### Phase 3: API Client Generation

**iOS (Swift):**
```bash
openapi-generator generate \
  -i https://api.trackyourregions.com/openapi.json \
  -g swift5 \
  -o ./TrackYourRegions/API
```

**Android (Kotlin):**
```bash
openapi-generator generate \
  -i https://api.trackyourregions.com/openapi.json \
  -g kotlin \
  --additional-properties=library=retrofit2 \
  -o ./app/src/main/java/api
```

## API Versioning Strategy

When mobile apps exist, API changes become more complex due to app store update delays.

**Recommended approach:** URL versioning
```
/api/v1/divisions
/api/v2/divisions  # Breaking changes go here
```

**Deprecation policy:**
1. New version released
2. Old version deprecated (still works, logs warnings)
3. 6-month sunset period for old version
4. Old version removed after all mobile users updated

## Checklist Before Starting Mobile

- [ ] All API responses use consistent envelope (`{ data: T }`)
- [ ] OpenAPI spec is generated and published
- [ ] API versioning is implemented (`/api/v1/...`)
- [ ] Authentication flow documented (if applicable)
- [ ] Rate limiting implemented and documented
- [ ] Error codes are documented with descriptions
- [ ] CI publishes OpenAPI spec on each release

## Timeline Estimate

| Phase | Tasks | When |
|-------|-------|------|
| Phase 1 | API consistency, OpenAPI | 1-2 months before mobile |
| Phase 2 | Repo setup | When starting mobile |
| Phase 3 | Client generation | Ongoing with mobile dev |

## Resources

- [OpenAPI Generator](https://openapi-generator.tech/)
- [Zod to OpenAPI](https://github.com/asteasolutions/zod-to-openapi)
- [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator)
