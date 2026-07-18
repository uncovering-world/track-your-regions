# Country Canon — Data Layer

Global registry of countries + disputed territories, **derived dynamically
from open sources by published rules** — never hand-authored. Design &
rationale: [planning/country-canon-and-disputes.md](planning/country-canon-and-disputes.md).

## Tables

- `countries` — superset registry: class `un_member | un_observer | de_facto
  | territory | special`, ISO codes, Wikidata QID, sovereign link, `sources`
  (provenance per record). Stable identity = `slug`. See Current State below
  for the live count.
- `country_divisions` — base coverage: country-level unit of the current unit
  source → country (country level = children of the tree roots; the roots
  are the 8 continents in the current import, so country-level units are
  their children — 237 of them, not the tree roots themselves). Rebuilt
  every sync.
- `disputed_territories` (+ `_members`, `_claims`) — disputes as unit sets of
  any level, landed geometrically from Natural Earth polygons; claimants with
  `controls`/`claims` roles.
- `disputed_presets` + `disputed_preset_choices` — derived presets
  (`de_facto` default, `un_widely_recognized`, `strict_neutral`).
- `user_disputed_preferences` — per-user resolution. **Sensitive** (political
  opinion): owner-only, never public, never logged.
- `division_canon_map` (matview) — every division → (base country,
  dispute-if-inside). Refreshed by the sync.
- `canon_sync_logs` — build history: status, report (diff, unmatched units,
  warnings), source versions. (Named for symmetry with `experience_sync_logs`;
  the design doc's original working name was `canon_import_log`.)

## The sync (how the list is built)

`backend/src/services/canonSync/` — admin-triggered service
(`syncCanon` / `getCanonSyncStatus` / `cancelCanonSync`), following the same
in-memory-progress pattern as the project's other sync services:

1. **Fetch** (raw responses cached in `data/cache/canon/`):
   - Wikidata SPARQL, **two queries**: the membership query (ISO codes
     P297/P298/P299, UN membership P463→Q1065 with no end date, limited
     recognition, P17 sovereign) and `fetchDisputeClaims` — a second query
     keyed by a `VALUES` list of the Natural Earth dispute features' own
     `WIKIDATAID`s, returning their P1336 claimants. This second query exists
     because attribution disputes like Crimea are not themselves rows in the
     membership query (they aren't countries), so their claims would
     otherwise be invisible to the derivation step.
   - Natural Earth admin-0 countries + disputed/breakaway GeoJSON.
   - Natural Earth's `SOV_A3` sovereignty codes are not plain ISO3 for
     multi-member groups (`GB1`, `IS1`, `NL1`, …) — `buildSovereignIso3Map` /
     `resolveSovereignCodes` resolve every `sovIso3` to the group's actual
     sovereign iso3 (identified by NE's `HOMEPART=1` flag, since `TYPE` is
     ambiguous across a group's members) before anything downstream —
     derivation, matching, or dispute landing — reads it.
2. **Derive** (`rules.ts` — the published rules, pure functions): membership
   = ISO ∪ UN ∪ limited-recognition; classes by rule; disputes from NE
   features; presets from source attributes. Manual input =
   `config/unit-match-overrides.json` (unit matching only) +
   `config/exceptions.json` (justified deviations, each with a citation). A
   third, minimal manual constant also feeds classification:
   `UN_OBSERVER_ISO2` (`types.ts`), the 2-entry UN GA observer list (VA, PS),
   hardcoded with its un.org citation and unchanged since 2012.
3. **Match geometrically** (`unitMatching.ts`): country-level units ↔ NE
   country polygons by max overlap; dispute polygons land on units (whole
   country unit or its children; partial → `is_approximate`). No unit-source
   codes involved — swapping GADM for another unit source only rebuilds this
   step.
4. **Load** (`loader.ts`): a single **transaction**. Countries upsert by slug
   (ids — and therefore user prefs — survive rebuilds); derived links
   (coverage, disputes, claims, presets) are replaced wholesale. A country or
   dispute the current draft no longer produces is deleted **unless** a
   `user_disputed_preferences` row still references it — in that case the
   row is retained inert (already stripped of its members/claims by the
   wholesale rebuild) and a warning is added to the report instead of
   deleting it. An empty derivation (zero countries) is refused rather than
   loaded — almost certainly a source/rule failure, not "the world has no
   countries." Refreshes `division_canon_map`, logs the report with a diff
   vs. the previous build.

API: `POST/GET/DELETE /api/admin/canon/sync` (admin-only, mounted under
`/api/admin` behind `requireAuth` + `requireAdmin`).

### Wikidata query notes

- Limited recognition uses **direct** `wdt:P31 wd:Q10711424` ("state with
  limited recognition"), not a transitive `P31/P279*` walk. The transitive
  form over-matches by roughly 25x — it pulls in unrelated Wikidata
  subclasses (Eswatini chiefdoms, South African bantustans, historical
  "barbarian kingdom" classes). `Q10711424` is also the *live* QID: the
  originally planned `Q15634554` was merged into it, and since SPARQL does
  not follow entity redirects, the stale QID silently matched zero rows.
- `FILTER NOT EXISTS { ?item wdt:P576 [] }` (P576 = dissolved/abolished date)
  excludes most historical entities whose UN-membership or
  limited-recognition statements lack end-date qualifiers (e.g. the
  Mongolian People's Republic, the German Democratic Republic, Yugoslavia).
  It is not exhaustive — a handful of dissolved entities carry no P576 claim
  either (e.g. duplicate "realm"/historical-polity entities for Denmark, the
  UK, Greece) and are instead handled as documented `exceptions.json`
  entries.

## Current state (2026-07-18)

Results of the first real calibrated sync (full log:
`.superpowers/sdd/task-9-report.md`):

- **277 countries**: `un_member` 192, `un_observer` 2, `de_facto` 24,
  `territory` 58, `special` 1 (Antarctica).
- **Crosswalk**: 227 of 237 country-level units matched; the 10 unmatched
  units are justified residuals (water bodies like the Caspian Sea,
  multi-claimant reef/island aggregates GADM has no single clean holder for)
  — recorded in the sync report, not silently dropped.
- **94 disputes** landed from the NE disputed/breakaway layer: 5 existence
  (Kosovo, Northern Cyprus, Somaliland, South Ossetia, Transnistria) and 89
  attribution. Crimea lands exactly on 2 units. 8 are zero-unit reef/islet
  disputes below the unit source's geometric resolution (e.g. Scarborough
  Reef, Hans Island) — recorded as approximate with no members, which is
  harmless. This set is far richer than the design doc's illustrative ~13 —
  that is the derivative principle working as intended: the dispute set
  comes from Natural Earth, not from us.
- Rebuilds against **unchanged sources** are idempotent: consecutive real
  syncs have been verified to produce an empty diff (no added/removed/changed
  countries). Genuine upstream edits (Wikidata/Natural Earth data changing
  between runs) surface in the build diff instead — that's the drift
  detector working as designed, not a regression. Identity collisions (two
  live entities sharing one ISO code, e.g. Q229 Republic of Cyprus vs
  Q644636 British Cyprus both carrying CY) resolve deterministically: the
  UN-member entity wins, else the entity with the lower Wikidata QID.
- 11 `exceptions.json` entries and 12 `unit-match-overrides.json` entries
  currently bridge Wikidata/NE data quirks (duplicate polity entities like
  the Danish/UK/Greek "realm" duals, Wikidata statement-rank artifacts,
  name-only unit matches) — each with a justification and source citation,
  per the "nothing hand-authored" invariant.

## Running locally

Trigger via the admin API (`POST /api/admin/canon/sync`, requires an admin
session), then poll `GET /api/admin/canon/sync` for progress and the last
build's report/diff. There is no dedicated admin UI yet (planned in slice 3
of the design doc).
