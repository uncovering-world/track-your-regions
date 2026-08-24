# Performance

Performance has numbers, budgets and a gate. This document says what is
measured, how, what the numbers were when the budgets were set, and the rule
for moving a budget. It is the reference for the two CI jobs that enforce
them and for the local commands that run the same checks and one more —
`perf:size`, `perf`, `perf:api`, and `perf:local` on the developer's own
data.

The lane exists to make an anti-pattern visible in the pull request that
introduces it — a dependency that doubles the bundle, a layout that shifts
under the visitor, a screen that blocks the main thread, a read that grows
with the catalogue — while the UI is still cheap to change. It does not
certify the current frontend as fast; the baseline below says plainly that
it is not, and the budgets sit just above that truth so that the gate
ratchets instead of aspiring.

## What is measured

| Tier | What | Budget lives in | Runs |
|------|------|-----------------|------|
| Bundle size | gzip size of the entry chunk and the stylesheet, from `vite build` | `frontend/package.json` → `"size-limit"` | CI **Build** job, after the frontend build; locally `npm run perf:size` |
| Lighthouse | LCP, TBT, CLS, TTI, the performance score, and transfer size per resource type, on the map view and Discover, against the **production build** served compressed inside the isolated test stack | `frontend/perf/lighthouse-budgets.json` | CI **Performance (Lighthouse)** job; locally `npm run perf` |
| Backend latency | p50/p95/max of the hot read endpoints — the by-region experience reads and the Martin tile functions | — (a measurement, recorded here) | locally `npm run perf:api` against a stack holding the real catalogue |
| Local run | all three, on the dev stack's production build and its real catalogue: the map view and Discover of the world view the database exposes | `frontend/perf/lighthouse-budgets.local.json` | locally `npm run perf:local` — the pre-push run for a change that touches what the browser loads or draws |

Why two tiers and not one: the bundle check is deterministic and needs no
browser, so it runs in the minutes the build already takes and fails on
exactly the change that caused it. Lighthouse needs a browser, a backend
and a tile server, and its timings carry the runner's noise — it runs on the
isolated stack the smoke lane uses, with the same "one command locally, the
same command in CI" symmetry.

## How the Lighthouse lane runs

`npm run perf` → `scripts/test-report.mjs perf` → `scripts/test-stack.sh
run-perf`, which:

1. brings the test stack up with `FRONTEND_MODE=preview`
   (`docker-compose.yml`), so the frontend container runs
   `frontend/docker-entrypoint.sh` in its preview shape: `vite build`, then
   `vite preview` on the same port and hostname the dev server uses
   (`http://frontend:5173`), so the backend's CORS origin and the browser's
   URLs do not change with the mode;
2. builds and starts the `e2e` container (the Playwright image) and runs
   `npm run lighthouse` inside it — `frontend/perf/lighthouse.mjs` — with
   `CHROME_PATH` pointing at the image's own pinned Chromium, so the
   numbers do not move with whatever Chrome a developer or a runner has
   installed. Chromium runs there as root with `--no-sandbox` and
   `--disable-dev-shm-usage` (a container's 64 MB `/dev/shm`), which is
   acceptable only because it browses the stack's own pages inside an
   ephemeral container — never point the lane at content the repository
   does not control;
3. the runner audits each URL in `lighthouse-budgets.json` three times
   with Lighthouse's desktop preset, keeps the **representative run**
   (Lighthouse's own `computeMedianRun`, the run closest to the median of
   its key timings — one real report, not a metric-by-metric composite no
   single run produced), judges it against the budgets, and writes every
   run's HTML/JSON report plus `manifest.json` and
   `assertion-results.json` into `frontend/lighthouse-report/`
   (bind-mounted out of the container, gitignored; CI uploads it as the
   `lighthouse-report` artifact on every run, green ones included, because
   the reports are how a budget is re-read when it is ratcheted);
4. `scripts/lighthouse-summary.mjs` turns the results into the lane
   summary `test-report.mjs` prints: one line per page with the score, LCP,
   TBT, CLS, TTI and script/total transfer, and one line per assertion that
   spoke.

Two properties of the measurement are deliberate and worth knowing before
reading a number:

- **The build is served compressed.** `vite preview` sends the entry chunk
  raw — 2.87 MB where any static host or CDN sends its gzip — and
  Lighthouse's simulated throttling works from transfer size, so a budget
  set against raw bytes would ratchet on a download no visitor makes. The
  preview server gets a `compression()` middleware in `vite.config.ts`;
  only the preview server, since the dev server serves unbundled modules
  and is not what the lane measures. `vite preview` still answers
  `Cache-Control: no-cache`, which Lighthouse notes under its diagnostics;
  it is not asserted, and a real host sets its own headers.
- **Desktop preset.** The product is a desktop map today (`mobile-planning.md`
  is a plan); the mobile preset's 4× CPU slowdown and slow-4G network on a
  2.8 MB bundle would produce numbers that describe a device the product
  does not yet address. A mobile matrix is a one-entry change to the
  budgets file when that changes.

The budget syntax is Lighthouse CI's (`"<key>": ["<level>", { <threshold> }]`),
evaluated by `frontend/perf/assertions.mjs`, so anyone who has read a
`lighthouserc.json` reads ours. Lighthouse CI itself is not used: at the time
of writing `@lhci/cli` pinned a year-old Lighthouse whose dependency tree
carried nine high-severity advisories, for a feature set this lane needs a
small part of — N runs, a median, a handful of assertions, reports on disk.
`lighthouse` itself (13.x) resolves clean. The runner keeps Lighthouse CI's
file shapes, so the tool can be swapped back in without touching the
summary printer or the CI job. The decision, the alternatives and what
would justify reversing it are ADR-0033.

`TEST_REPORT_LOCAL=1` has no meaning for this lane and is refused with a
message: there is no host-side shape of it that would produce comparable
numbers. The runner also refuses a page served by Vite's dev server (it
looks for `/@vite/client` in the document): the first run of the lane hit
the dev server through a stack left up in the other mode and reported 370
script requests, 19.7 MB and a 17.6 s LCP as if they were the bundle's —
numbers that describe the development shape, and a mistake the lane must
not be able to make twice.

## The local run: the developer's own data

The CI lane measures a fixture and therefore the shell. Most of what a
visitor feels on the real catalogue lives in the data — the size of a
region's reads, the number of markers, the geometry behind a tile — and
that data lives on the developer's machine. `npm run perf:local`
(`scripts/perf-local.sh`) measures everything one machine can, in the order
things fail fastest:

1. the bundle-size budget (`npm run perf:size`);
2. Lighthouse against the **dev stack's frontend in its production shape**
   — `scripts/frontend-mode.sh preview` switches the container to
   `FRONTEND_MODE=preview` and waits for the built page — on the pages of
   the world view the database exposes (`/?wv=5`, `/discover?wv=5`), driven
   by the machine's own Chrome and judged against
   `frontend/perf/lighthouse-budgets.local.json`;
3. the latency probe (`npm run perf:api`).

**Performance is measured on the production build, never on the dev
server.** The dev server serves unbundled modules with HMR and no
compression, and its numbers describe the tooling: 370 script requests,
19.7 MB and a 17.6 s LCP where the built page is one request, 783 kB and
1.4 s. The Lighthouse runner refuses it. The dev stack's frontend has both
shapes and three commands — `npm run dev:frontend:preview`,
`dev:frontend:dev`, `dev:frontend:mode` — and two tells without a command:
the dev server's tab is titled "Track Your Regions (dev server)" and its
document loads `/@vite/client`; the built page has the plain title and one
hashed `/assets/index-*.js`. The local run leaves the frontend in its
production shape, ready to be opened and looked at.

Two things make the local run's numbers its own, not the lane's: the
machine (a 2016 laptop here) and the database (whatever the dev stack
holds). Its **byte budgets are the gate** — they are deterministic — and its
timings are set wide, at `warn`, to be read rather than to fail. The pages
and the probe name one world view and one region; the budgets file carries
the ones the baseline was measured on (`worldView: 5`, substituted into
`{worldView}` in its URLs), and another database names its own:
`npm run perf:local -- --world-view 7 --region 42` reaches both the probe
and the runner. The world view has to be public for the pages to load
(`is_public` on `world_views`; the dev database's mirror world view is
public for this reason) — and because a world view the visitor cannot see
falls back to the default one without a word, after one request for it
that answers 404, the runner checks that the representative run made a
request containing `/api/world-views/<id>/` **that was answered 2xx** — a
CORS preflight's 204 does not count — (`expectRequestMatching`) and fails
rather than measuring another page under the same name. The frontend's port comes from `.env` like the world
view comes from the flag (`{port}` in the local budgets' URLs). The switch
touches only the frontend container (`--no-deps`) and waits for the
backend's `/health` before anything is measured.

What the local run cannot yet see is the interactions where the data cost
actually lives — clicking Europe, opening a card — because none of them has
a URL (#644) and Lighthouse's navigation mode measures page loads; #646
adds scenarios (timespans around scripted interactions) to it. Making the
CI lane itself see production-like data — a scaled synthetic fixture on
pull requests, the golden dump nightly — is #647.

## Baseline

Recorded when the budgets were first set. Re-measure and replace the tables
when a budget is deliberately moved; do not append — a living document
carries the current truth, and git carries the history.

### Bundle — 2026-08-24

`vite build` (vite 8.0.16), measured by `size-limit`:

| File | Raw | gzip |
|------|-----|------|
| `dist/assets/index-*.js` (the entry chunk — the whole application) | 2 865.7 kB | **779.6 kB** |
| `dist/assets/index-*.css` | 65.9 kB | **9.3 kB** |

One chunk. Every route — the admin panels, curation, the review queue, the
world-view editor — ships to the anonymous visitor who opens the map. This
is the largest single item in every number below, and it is filed as #643
(see the breaches below).

### Lighthouse — 2026-08-24

Against the test stack's fixture (world view 9001, one region, three
experiences), so these describe the **shell** — the bundle, the map's first
paint, the layout — not a region's worth of markers and cards. The
region-heavy paths are measured by the backend probe below, on the real
catalogue.

Representative run of three, desktop preset, transfer sizes as served
(gzip).

Local machine (Intel i7-6600U, 2 cores / 4 threads, 2016 laptop; Docker on
Fedora):

| Page | Score | FCP | LCP | TBT | CLS | TTI | script | total (requests) |
|------|-------|-----|-----|-----|-----|-----|--------|-------|
| `/?wv=9001` (map view) | 86 | 0.96 s | 1.38 s | 229 ms | 0.006 | 1.90 s | 782.7 kB | 910.3 kB (39) |
| `/discover?wv=9001` | 92 | 1.19 s | 1.39 s | 83 ms | 0.000 | 1.59 s | 782.7 kB | 983.1 kB (42) |

What the report says behind those numbers, on the day the lane was
switched on:

- **70–72 % of the entry chunk is unused** on either page (549–563 kB of
  782 kB, "Reduce unused JavaScript") — the admin, editor, curation and
  review code the visitor never runs; see the single-chunk issue below.
- The two fonts (Syne, Figtree; 54.8 kB) come from Google Fonts, the only
  origin outside the repository's control that the shell touches. Lighthouse's
  `third-party` resource row counts them together with the stack's own backend
  and tile server, which are different origins too — which is why no budget
  is set on that row: it would be gating the stack's shape, not a dependency.
- Every backend read is preceded by a CORS **preflight**: the frontend and
  the backend are different origins in every stack this repository runs,
  so 39 requests are roughly 20 round trips. A same-origin deployment
  (#585, reverse proxy) removes them; until then the request count reads
  double.
- 11–15 long tasks, the longest 180 ms, all inside the entry chunk's
  evaluation — TBT is the bundle being parsed, not the map being drawn.

CI runner (GitHub-hosted `ubuntu-latest`, 4 vCPU; the lane's first run on
the pull request that added it, and the numbers the timing budgets are
calibrated against):

| Page | Score | FCP | LCP | TBT | CLS | TTI | script | total (requests) |
|------|-------|-----|-----|-----|-----|-----|--------|-------|
| `/?wv=9001` (map view) | 95 | 0.96 s | 1.37 s | 16 ms | 0.006 | 1.52 s | 782.7 kB | 912.3 kB (39) |
| `/discover?wv=9001` | 93 | 1.17 s | 1.36 s | 0 ms | 0.000 | 1.36 s | 782.7 kB | 985.9 kB (42) |

Across the three runs per page the runner's spread was LCP 1.33–1.49 s,
TBT 0–128 ms, TTI 1.33–1.64 s, and the request count did not move. The
runner is faster than the laptop above on everything the CPU decides
(TBT, TTI) and identical on what the simulated network decides (LCP), which
is why the timing budgets are set from here and a loaded laptop can trip
them: a local run while Semgrep and Trivy were scanning in parallel
measured 665 ms of TBT on the map view. Run the lane on a quiet machine, or
read a local timing miss as information rather than a verdict.

### Local run — 2026-08-24

`npm run perf:local` on the same laptop, against the dev stack's production
build and its database (1 604 experiences / 6 693 locations; world view 5
"Administrative", 3 831 regions, 3 594 of them leaves). Representative run of
three, desktop preset, the machine's own Chrome:

| Page | Score | FCP | LCP | TBT | CLS | TTI | script | total (requests) |
|------|-------|-----|-----|-----|-----|-----|--------|-------|
| `/?wv=5` (map view, eight continents) | 62 | 1.19 s | 1.46 s | 993 ms | 0.001 | 2.80 s | 782.7 kB | 2 231.3 kB (40) |
| `/discover?wv=5` | 90 | 1.18 s | 1.39 s | 121 ms | 0.011 | 1.82 s | 782.7 kB | 1 022.5 kB (43) |

The first run on real data found three things the fixture could not show,
each filed with its numbers:

- **`GET /api/world-views/5/regions/leaf` — 1 105 kB, 3 594 rows** — is
  fetched on the map root to look up the metadata of the eight regions on
  screen, and is the largest transfer on the page, ahead of the entry
  chunk; the 993 ms of TBT across thirteen long tasks (366, 293, 279 ms …)
  is that list being parsed and indexed. Discover, which does not make the
  read, sits at 121 ms on the same world view. #649.
- **Every backend response is uncompressed** — the leaf list, the 624 kB
  by-region read, the 973 kB of locations: no compression middleware, no
  `Content-Encoding`. JSON of this shape compresses five- to eight-fold.
  #650.
- **`favicon.ico` is 86 kB**, fetched on every page, the third-largest
  transfer after the chunk and the leaf list. #648.

### Backend latency — 2026-08-24

`npm run perf:api` against the dev stack (the same i7-6600U laptop,
PostgreSQL 17.10 / PostGIS 3.5.6 in Docker),
database holding 1 604 experiences / 6 693 locations, world view
"Administrative" (id 5, 3 831 regions, the base-layer mirror every
experience is placed in), region Europe (id 6737, 683 experiences assigned
directly, the heaviest read a click on a continent makes). 30 timed
requests per endpoint after one warm-up, backend requests paced to stay
under `publicReadLimiter`'s 60 a minute; p95 by linear interpolation
between ranks, since nearest-rank p95 is the maximum under another name at
any sample count below twenty. Tile requests carry a cache-buster so
Martin's in-memory tile cache is not what gets timed. A sample that times
out or answers anything but 200 is counted as a failure and left out of
the timings.

| Endpoint | bytes | p50 | p95 | max |
|----------|-------|-----|-----|-----|
| `GET /api/experiences/by-region/6737?includeChildren=true&limit=5000` | 624 kB | 101 ms | 149 ms | 185 ms |
| `GET /api/experiences/by-region/6737/locations?includeChildren=true` | 973 kB | 153 ms | 263 ms | 268 ms |
| `GET /api/experiences/region-counts?worldViewId=5` | 1.0 kB | 16 ms | 22 ms | 28 ms |
| `tile_world_view_root_regions/3/4/2` (Europe, z3 — the #551 tile) | 3.7 kB | 14 ms | 26 ms | 27 ms |
| `tile_world_view_root_regions/5/16/10` | 3.1 kB | 17 ms | 35 ms | 36 ms |
| `tile_region_subregions/5/16/10?parent_id=6737` | 10.3 kB | 30 ms | 61 ms | 62 ms |
| `tile_world_view_all_leaf_regions/3/4/2` | 63.1 kB | 80 ms | 160 ms | 163 ms |
| `tile_gadm_root_divisions/3/4/2` | 5.9 kB | 27 ms | 57 ms | 63 ms |

The bare `npm run perf:api` names exactly these targets (its defaults are
world view 5 and region 6737), so it reproduces this table; a different
database needs `--world-view` and `--region`. The probe is anonymous, as a
visitor is, so it can only read a world view that is public — the dev
database's mirror world view was made public for the run and set back
afterwards; against a world view that is not, every backend row comes
back as a 404 failure rather than a number.

Two readings of that table:

- **Opening Europe costs 1.6 MB before a marker is drawn** — 624 kB of
  rows for the list and 973 kB of locations for the map, both whole-region
  reads (`WHOLE_REGION_LIMIT`). Under half a second on this database at
  p95, and growing with every sync; the lane's fixture cannot see it,
  which is why the row is here.
- **The #551 tile no longer costs 676 ms on this database.** The same z3
  tile that issue measured answers in tens of milliseconds and 3.7 kB, with
  Martin's cache busted per request: ADR-0031 (2026-08-23) sized the
  coarse rung by the pixel rule after re-measuring the same tile at
  483–508 ms, and the probe's row is that rung. The issue carries this
  measurement and should be re-verified against the probe before any
  further work on it starts.

## Budgets and the ratchet rule

| Budget | Level | Value | Set from |
|--------|-------|-------|----------|
| entry chunk, gzip (`size-limit`) | error | 825 kB | 779.6 kB baseline + ~6 % |
| stylesheet, gzip (`size-limit`) | error | 10 kB | 9.3 kB baseline |
| `resource-summary:script:size` | error | 825 000 B | 782 659 B transferred — the same chunk, as Lighthouse sees it |
| `resource-summary:stylesheet:size` | error | 12 000 B | 10 733 B (the app's CSS plus the Google Fonts stylesheet) |
| `resource-summary:total:size` | error | 1 050 000 B | 983 126 B on Discover, the heavier of the two |
| `resource-summary:total:count` | error | 60 | 39 / 42 requests, preflights included, the same in all six CI runs — an N+1 shows up here as tens |
| `largest-contentful-paint` | error | 2 000 ms | 1.33–1.49 s on the CI runner (1.38 / 1.39 s locally); network-simulated, so the least noisy timing |
| `total-blocking-time` | error | 300 ms | 0–128 ms on the CI runner (229 ms locally, quiet); the noisiest number the lane has, hence the widest headroom |
| `cumulative-layout-shift` | error | 0.02 | 0.001–0.006 / 0.000 on the CI runner |
| `interactive` | error | 2 500 ms | 1.33–1.64 s on the CI runner (1.90 / 1.59 s locally) |
| `categories:performance` | warn | 0.8 | informational — the composite score moves ±5 points on identical hardware and is not a gate |

The local run has its own file, `frontend/perf/lighthouse-budgets.local.json`,
with the same script and stylesheet lines, a total-size line at 2 350 000 B
(the map root's 2 231 kB, most of it the leaf list of #649 — the line drops
when that lands) and a request count of 60 as errors, and every timing at
`warn` set wide for a laptop (LCP 2.5 s, TBT 1.2 s, CLS 0.02, TTI 3.5 s,
score 0.5): the local run's bytes gate, its timings inform.

The rule:

- **A budget sits just above the last measured baseline.** Bytes get about
  5 % of headroom — a routine feature moves the chunk by a kilobyte or two,
  a new dependency by tens to hundreds, and the budget is there to catch
  the second, not to be re-set by the first every other week. Timings get
  the headroom the runner's own noise needs: they are calibrated on the CI
  runner, not on a laptop, at roughly the 90th percentile of the runs
  observed there, rounded up.
- **Lowering a budget is a deliberate pull request** — after a change that
  earned it, with the new baseline recorded here.
- **Raising a budget needs a stated reason in the pull request** — what
  grew, why it is worth it, and what the visitor gets for it. "The gate
  went red" is not a reason.
- **Bytes are `error` from the day they are set.** They are deterministic.
  **Timings start at `warn`** when a page is first measured and move to
  `error` once CI runs have shown where they sit — a timing budget copied
  from a developer's machine gates on the wrong hardware. The two pages
  above went through exactly that on the pull request that added the lane:
  first run at `warn`, budgets set from its numbers, second run at `error`.

When the gate goes red, read the report before touching the budget:
`frontend/lighthouse-report/` (locally) or the `lighthouse-report` artifact
(CI) holds every run's HTML, which names the element behind the LCP, the
long tasks behind the TBT and the request behind a byte budget.

## Known breaches and gaps

Filed, and linked here so the baseline is read with them in mind:

- #643 — the whole application is one 2.87 MB chunk;
  the visitor downloads the admin panels to see a map.
- #644 — a selected region or experience is not in the URL
  (only `?wv=` is), so a place cannot be shared and the experience card
  cannot be a Lighthouse page. Until it is, the lane measures the two
  shells and not the card.
- #551 — the region tile LOD ladder: a z3 tile costs hundreds of
  milliseconds of Postgres time for a few kilobytes. The first known breach
  on the backend side; the probe's row for `tile_world_view_root_regions/3/4/2`
  is its number.
- #560 — island specks survive simplification and bloat cold tiles.
- #557 — experience pictures hotlinked at 8–40 MB from UNESCO and Commons;
  not visible in the fixture-backed Lighthouse run (three experiences, no
  pictures), which is one reason the fixture's numbers describe the shell.
- The unpaged region list: `WHOLE_REGION_LIMIT = 5000` rows in one read
  (`docs/tech/experience-map-ui.md` § Shared state model); the probe's
  by-region row is what that costs on Europe today.

What the lane does not measure, by design or not yet:

- **Field data.** Everything here is lab data on one machine class; there
  is no real-user monitoring, and there is no production host to attach
  one to (#585).
- **Mobile.** Desktop preset only, see above.
- **A loaded region, in CI.** The fixture is three experiences; the lane
  sees the shell. The local run sees the real catalogue on one machine;
  #647 brings production-like data to CI (a scaled fixture on pull
  requests, the golden dump nightly).
- **Interactions.** Opening a continent, opening a card — the moments the
  data cost is paid — have no URL (#644) and are not navigations; #646
  measures them as scripted scenarios in the local run.
