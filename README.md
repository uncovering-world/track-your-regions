# Track Your Regions

A travel memory and discovery platform. Not just pins on a map — a living record of your relationship with places around the world.

## The Idea

Travel is not binary. You don't just "visit" a place — you might pass through it on a train, explore its back streets for a week, or know everything about it from books without ever setting foot there. Track Your Regions models this spectrum of connection and gives you tools to explore, track, and deepen your engagement with the world.

### What you can do today

- **Explore an interactive world map** — browse countries, states, and custom regions rendered as vector tiles at any zoom level
- **Track where you've been** — click a region to mark it visited, building a personal travel map at a glance
- **Discover experiences** — browse 4,000+ UNESCO World Heritage Sites, top museums, and public art & monuments organized by region, with images, descriptions, and external links
- **Create your own world views** — group countries into continents, cultural zones, or any hierarchy that makes sense to you. Draw custom boundaries, split regions, use AI-assisted tools
- **Curate content** — community-driven quality layer where curators edit, add, reject, and manage experiences for their regions

### Where we're headed

- **Connection levels** — replace visited/not-visited with a spectrum from "Stranger" to "Deep Connection," inferred through quizzes and decaying over time as memories fade
- **Quiz-based onboarding** — reconstruct your travel history through play instead of tedious data entry
- **More experience categories** — books & films set in a region, regional food, festivals, notable people, wildlife, intangible heritage
- **Locals' perspective** — user-generated content from people who know a place deeply
- **Social features** — follow travelers, plan journeys together, share your map

See the full [Vision document](docs/vision/vision.md) for details on user roles, design principles, and planned features.

## Design Principles

1. **Reflection over logging** — help people remember and appreciate, not passively track
2. **Play over data entry** — quizzes, visual maps, and badges make tracking fun
3. **Depth over breadth** — reward deep engagement with a few places over superficial visits to many
4. **Local expertise** — curators bring regional knowledge; locals amplify authentic voices
5. **Cultural respect** — no ranking cultures. Cultural relativism guides presentation
6. **Open data** — built on UNESCO, Wikidata, and GADM

## Getting Started

**Prerequisites:** Docker + Docker Compose, Node.js 22+

```bash
npm run setup   # interactive: writes .env, generates JWT secret,
                # creates your admin account (run once)
npm run dev     # start all services via Docker Compose
```

Open **http://localhost:5173** and log in with the admin account you
created in `setup`.

The map is empty on first run. Load world boundaries once with:

```bash
npm run db:load-gadm   # offers to download the data if missing, then
                       # loads it in Docker (no local Python/GDAL needed)
```

This is a one-time step and is slow — expect tens of minutes to a
couple of hours depending on your machine.

**Dev sign-ups (non-admin):** email verification links are printed to
the backend Docker logs — no SMTP configuration needed.

Run `npm run help` for the full command reference.

### Optional integrations

Everything below is **off by default** and the app runs fine without it. To
enable one, set its variables in `.env` (see `.env.example` for the full list
and comments) and restart (`docker compose down && npm run dev`). The backend
logs each integration's status at startup.

| Integration | Variables | How to get them | Behavior when unset |
|-------------|-----------|-----------------|---------------------|
| **Map data (GADM)** | — | `npm run db:load-gadm` (offers to download) | Map is empty |
| **Google login** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — redirect URI `http://localhost:3001/api/auth/google/callback` | Google button disabled |
| **AI features** | `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | AI-assisted grouping/descriptions disabled |
| **Email (SMTP)** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | any SMTP provider | Verification links print to the backend logs |
| **Apple Sign-In** | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Apple Developer Console (see `docs/tech/authentication.md`) | Apple button disabled (untested) |

## Documentation

Detailed docs live in [`docs/`](docs/README.md):

- **[Vision](docs/vision/vision.md)** — what we're building and why, user roles, future plans
- **[Tech docs](docs/README.md#tech--implemented-features)** — architecture, domain model, auth, experiences, geometry
- **[Planning](docs/README.md#tech--planning)** — upcoming features and design decisions
- **[Security](docs/README.md#security)** — OWASP ASVS Level 2 profile and audit status

## License

Apache-2.0
