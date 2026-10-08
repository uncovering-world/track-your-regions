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

GADM's data is free for non-commercial use only, and serving it
publicly needs GADM's permission. See [License](#license) before you
put an instance on a public host.

**Dev sign-ups (non-admin):** email verification links are printed to
the backend Docker logs — no SMTP configuration needed.

Run `npm run help` for the full command reference.

### Optional integrations

Everything below is **off by default** and the app runs fine without it.
`npm run setup` interactively offers to configure **Google login**, **AI
features**, and **map data (GADM)** — it prompts only for ones still unset, so
re-running it fills in any you skipped. **Email (SMTP)** and **Apple Sign-In**
are manual: set their variables in `.env` (see `.env.example` for the full list
and comments) and restart (`docker compose down && npm run dev`). The backend
logs each integration's status at startup.

| Integration | Variables | How to get them | Behavior when unset |
|-------------|-----------|-----------------|---------------------|
| **Map data (GADM)** | — | `npm run db:load-gadm` (offers to download) | Map is empty |
| **Google login** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — redirect URI `http://localhost:3001/api/auth/google/callback` | Google button disabled |
| **AI features** | `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | AI-assisted grouping/descriptions disabled |
| **Review suggestions** | `JEV_API_KEY` | [typesafe.ai](https://typesafe.ai) | No Jev suggestion on the review card for two disagreeing sources |
| **Email (SMTP)** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | any SMTP provider | Verification links print to the backend logs |
| **Apple Sign-In** | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Apple Developer Console (see `docs/tech/authentication.md`) | Apple button disabled (untested) |

## Documentation

Detailed docs live in [`docs/`](docs/README.md):

- **[Vision](docs/vision/vision.md)** — what we're building and why, user roles, future plans
- **[Tech docs](docs/README.md#tech--implemented-features)** — architecture, domain model, auth, experiences, geometry
- **[Planning](https://github.com/uncovering-world/track-your-regions/milestones)** — upcoming work is GitHub issues, and the roadmap is the open milestones ([where things live](docs/README.md#where-things-live))
- **[Security](docs/README.md#security)** — OWASP ASVS Level 2 profile and audit status

## License

The **code** in this repository is licensed under [Apache-2.0](LICENSE).

The **data** the product loads and serves is not part of the repository and is not covered by
that licence. Each source keeps its own terms, and whoever runs an instance with that data
loaded is bound by them:

| Source | What the product takes | Terms |
|--------|------------------------|-------|
| [GADM](https://gadm.org/license.html) 4.1 | Administrative boundaries, loaded by `npm run db:load-gadm` and served as map tiles | Free for academic and other **non-commercial** use. **Redistribution or commercial use needs GADM's prior permission**, and serving the boundaries publicly (the tiles, the API) is redistribution. |
| [UNESCO World Heritage List](https://data.unesco.org/explore/dataset/whc001/) (`whc001`) | The list of properties, their descriptions and components | CC BY-SA 4.0, per the dataset's metadata |
| [Wikidata](https://www.wikidata.org/wiki/Wikidata:Licensing) | Places, works, classes and coordinates | CC0 |
| [Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Licensing) | Every picture, linked and never copied | Each file under its own licence, credited under the picture |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Site extents and site verdicts; the basemap tiles | ODbL, "© OpenStreetMap contributors". What the catalogue takes is kept separable and offered under ODbL |
| [Wikivoyage](https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft) | The region hierarchy of the Wikivoyage world view | CC BY-SA 4.0 |
| [CARTO basemaps](https://carto.com/basemaps/) | The Positron basemap under several admin screens and a world-view editor dialog | Free for **non-commercial** use, with "© OpenStreetMap contributors, © CARTO" shown; an API key and a monthly request ceiling apply outside CARTO's platform (open in #651) |

This project runs the product as a public, **non-commercial** service. It asks GADM's
permission before any public host is set up. Anyone who runs their own public instance
needs that permission too. See
[ADR-0078](docs/decisions/0078-the-product-is-public-and-non-commercial-and-gadm-is-asked-before-it-is-published.md),
[ADR-0059](docs/decisions/0059-what-the-catalogue-takes-from-openstreetmap-it-keeps-separable-and-offers-under-odbl.md)
(OpenStreetMap) and
[ADR-0043](docs/decisions/0043-a-picture-we-show-is-one-we-may-show.md) (pictures).
