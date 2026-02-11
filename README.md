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

**Prerequisites:** Docker, Node.js 20+, pnpm, and the [GADM 4.1 GeoPackage](https://gadm.org/download_world.html) (`gadm_410.gpkg`) placed in `./deployment/` or `~/`

```bash
cp .env.example .env
pnpm install
npm run db:up
npm run db:create my_regions
npm run db:load-gadm            # Load world boundaries (~30 min, one-time)
npm run dev                     # Start everything
```

Open **http://localhost:5173** — you should see the world map.

To get admin access (run syncs, manage content), register through the UI, then:

```bash
npm run db:shell
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

Run `npm run help` for the full command reference.

## Documentation

Detailed docs live in [`docs/`](docs/README.md):

- **[Vision](docs/vision/vision.md)** — what we're building and why, user roles, future plans
- **[Tech docs](docs/README.md#tech--implemented-features)** — architecture, domain model, auth, experiences, geometry
- **[Planning](docs/README.md#tech--planning)** — upcoming features and design decisions
- **[Security](docs/README.md#security)** — OWASP ASVS Level 2 profile and audit status

## License

Apache-2.0
