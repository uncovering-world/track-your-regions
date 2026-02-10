# Track Your Regions

A web application for tracking visited regions and organizing them into custom World Views.

## Key Features

- **World Views** - Create custom regional organizations beyond GADM hierarchy
- **Administrative Divisions** - Browse GADM official boundaries (countries, states, etc.)
- **Custom Regions** - Group administrative divisions into meaningful regions
- **Custom Boundaries** - Draw polygons for partial regions
- **Geometry Computation** - Automatic merging and simplification
- **TypeScript everywhere** - Full type safety in both frontend and backend
- **Modern React stack** - Vite + React 18 + TanStack Query
- **PostGIS-native geometry** - Heavy operations done in database
- **Pre-simplified geometries** - 3 LOD tiers for fast map rendering

## Prerequisites

- Docker & Docker Compose
- Node.js 20+ and pnpm
- Python 3.9+ with GDAL (for GADM import)

## Quick Start

```bash
# 1. Setup
cp .env.example .env
pnpm install

# 2. Start PostgreSQL
npm run db:up

# 3. Create your database (auto-switches to it)
npm run db:create my_regions

# 4. Load GADM data (~30 minutes)
npm run db:load-gadm

# 5. Start the application
npm run dev
```

Open http://localhost:5173

## Testing

Use these commands from the repo root:

```bash
npm run test               # Backend + frontend unit/integration tests
npm run test:coverage      # Coverage for backend + frontend
npm run test:e2e:smoke     # Smoke E2E
npm run test:e2e:full      # Full E2E
```

All test commands use an isolated test environment by default and print a final report
showing executed files/cases and pass/fail totals.

## Database Management

All database commands operate on the "active" database. Create a database and it automatically becomes active.

### Commands

```bash
npm run db:up              # Start PostgreSQL container
npm run db:down            # Stop PostgreSQL container
npm run db:create [name]   # Create new database and switch to it
npm run db:list            # List all databases
npm run db:use <name>      # Switch to a different database
npm run db:status          # Show current DB info and row counts
npm run db:shell           # Open psql shell to current DB
npm run db:mark-golden     # Protect current DB from deletion
npm run db:unmark-golden   # Remove protection
npm run db:drop <name>     # Delete a database (not golden)
```

### Working with Multiple Databases

```bash
# Your main DB becomes important - protect it
npm run db:mark-golden

# Create another DB for experiments
npm run db:create experiment   # Creates AND switches
npm run db:load-gadm           # Load fresh data
# ... experiment ...

# Switch back to main
npm run db:use my_regions

# Clean up
npm run db:drop experiment
```

### Using an Existing Database

```bash
# If you already have a database set up:
echo "track_regions" > .active-db
npm run db:mark-golden
npm run db:status
```

## Project Structure

```
track-your-regions/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── src/
│   │   ├── index.ts        # Server entry point
│   │   ├── routes/         # API route definitions
│   │   ├── controllers/    # Request handlers
│   │   ├── db/             # Drizzle schema & connection
│   │   ├── middleware/     # Error handling, validation
│   │   └── types/          # Shared types & Zod schemas
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── main.tsx        # React entry point
│   │   ├── App.tsx         # Root component
│   │   ├── api/            # API client functions
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom React hooks
│   │   └── types/          # TypeScript interfaces
│   └── package.json
├── db/
│   ├── init/
│   │   ├── 01-schema.sql           # Tables, indexes, triggers, auth
│   │   ├── 02-martin-functions.sql # Martin vector tile functions
│   │   └── 03-geom-3857-columns.sql# SRID 3857 columns & simplification
│   └── init-db.py                  # GADM data loader
└── scripts/
    ├── db-cli.sh           # Database management CLI
    └── test-stack.sh       # Test environment runner (used by npm test commands)
```

## API Endpoints

### Administrative Divisions (GADM)
- `GET /api/divisions/root` - Get root administrative divisions
- `GET /api/divisions/:id` - Get division by ID
- `GET /api/divisions/:id/subdivisions` - Get subdivisions
- `GET /api/divisions/:id/ancestors` - Get parent chain
- `GET /api/divisions/:id/siblings` - Get sibling divisions
- `GET /api/divisions/:id/geometry` - Get GeoJSON geometry
- `GET /api/divisions/search` - Search by name

### World Views
- `GET /api/world-views` - List world views
- `POST /api/world-views` - Create world view
- `PUT /api/world-views/:id` - Update world view
- `DELETE /api/world-views/:id` - Delete world view

### Regions (within World Views)
- `GET /api/world-views/:id/regions` - List regions
- `POST /api/world-views/:id/regions` - Create region
- `GET /api/world-views/regions/:id/members` - Get region members
- `POST /api/world-views/regions/:id/members` - Add members
- `POST /api/world-views/regions/:id/geometry/compute` - Compute geometry

See [docs/tech/world-views.md](docs/tech/world-views.md) for full API documentation.

## Authentication

The application uses JWT-based authentication with support for:
- Email/password registration and login
- Google OAuth
- Apple Sign-In (requires Apple Developer account)

### Quick Setup

Auth tables are created automatically when you run `npm run db:create`.

1. Register via API:
   ```bash
   curl -X POST http://localhost:3001/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email": "admin@example.com", "password": "YourPassword123", "displayName": "Admin"}'
   ```

2. Promote to admin:
   ```bash
   docker exec -i tyr-ng-db psql -U postgres -d track_regions \
     -c "UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';"
   ```

3. Configure environment variables in `.env`:
   ```bash
   JWT_SECRET=your-secure-random-secret  # Required for production!
   FRONTEND_URL=http://localhost:5173
   
   # Optional: Google OAuth
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

See [docs/tech/authentication.md](docs/tech/authentication.md) for complete setup instructions, including OAuth configuration and security considerations.

## Geometry Optimization

The system uses three levels of geometry detail:

| Level | Simplification | Use Case |
|-------|---------------|----------|
| `low` | 0.1° tolerance | World/continent overview |
| `medium` | 0.01° tolerance | Country/state level |
| `high` | No simplification | Detailed view |

Request detail level via query param:
```
GET /api/divisions/123/geometry?detail=low
```

Geometries are pre-simplified on insert via database triggers, so requests are fast.

## GADM Data

The application uses [GADM](https://gadm.org/) data for administrative boundaries. Download `gadm_410.gpkg` and place it in one of:
- `./deployment/gadm_410.gpkg`
- `~/gadm_410.gpkg`

Then run `npm run db:load-gadm`.

## Tech Stack

### Backend
- Express.js with TypeScript
- Drizzle ORM
- PostgreSQL + PostGIS
- Zod for validation

### Frontend
- Vite
- React 18
- TypeScript
- TanStack Query (React Query)
- TanStack Virtual (for large lists)
- Material UI
- react-map-gl + MapLibre GL

## License

Apache-2.0
