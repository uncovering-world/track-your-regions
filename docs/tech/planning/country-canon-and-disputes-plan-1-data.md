# Country Canon — Plan 1: Data Foundation (schema + canon sync service)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canon of countries + disputed territories exists in the DB, built **dynamically** by an admin-triggered sync service that fetches open sources (Wikidata, Natural Earth), applies published rules, lands geometry on the current unit source, and reports a diff — per the spec [country-canon-and-disputes.md](country-canon-and-disputes.md), slice 1.

**Architecture:** New tables + one materialized view in `db/init/01-schema.sql` (raw `pool` SQL, no Drizzle in this slice). New backend service `backend/src/services/canonSync/` following the `wv-extract` module pattern (module-level progress, `syncCanon()` / `getCanonSyncStatus()` / `cancelCanonSync()`), reusing `sparqlQuery` from `sync/wikidataUtils.ts` and `FileCache` from `wikivoyageExtract/cache.ts`. Pure derivation rules are unit-tested with fixtures; geometry matching runs in PostGIS via a temp table; three admin endpoints under `/api/admin/canon/sync`.

**Tech Stack:** TypeScript, Express, PostgreSQL/PostGIS (`pg` raw pool), Vitest, Wikidata SPARQL, Natural Earth GeoJSON.

## Global Constraints

- **No commits without Nikolay's explicit OK** — session runs local-only. Every task ends with a **Checkpoint** step (show diff, offer commit message) instead of an unconditional commit.
- **No new dependencies** (`fetch` is native, `pg` + vitest already present).
- Spec invariants apply verbatim: canon references only internal `administrative_divisions.id`; no GADM codes stored in canon tables; membership NEVER hand-authored — only `unit-match-overrides.json` (unit name matching) and `exceptions.json` (justified rule deviations) are manual.
- Table name note: the spec's working name `canon_import_log` is implemented as **`canon_sync_logs`** (symmetry with `experience_sync_logs`).
- **Country-level units** (verified against the dev DB 2026-07-18): the division tree's ROOTS are 8 continents; the country level is their CHILDREN — `parent_id IN (SELECT id FROM administrative_divisions WHERE parent_id IS NULL)`, 237 units. Names are NOT unique at this level (Antarctic claim slices are named after claimant countries — "France" exists under both Europe and Antarctica), which is why geometric matching is primary and name matching only a fallback with a root-name disambiguator.
- Network access happens only inside the sync (admin-triggered); raw responses cached in `data/cache/canon/` (untracked, like `wikivoyage-cache`).
- Pre-commit gates before the final checkpoint: `npm run check`, `TEST_REPORT_LOCAL=1 npm test`, `/security-check`.
- Commit style if/when allowed: `back:` / `docs:` prefixes, DCO sign-off (`git commit -s`).

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `db/init/01-schema.sql` | Canon DDL: 9 tables + `division_canon_map` matview | **Modify** (append before "Schema Complete") |
| `backend/src/services/canonSync/types.ts` | All shared types + progress store | **Create** |
| `backend/src/services/canonSync/config/unit-match-overrides.json` | Manual root-unit ↔ country matches | **Create** |
| `backend/src/services/canonSync/config/exceptions.json` | Justified deviations from rule output | **Create** |
| `backend/src/services/canonSync/wikidataSource.ts` | SPARQL query + row parsing | **Create** |
| `backend/src/services/canonSync/wikidataSource.test.ts` | Parse tests (fixtures) | **Create** |
| `backend/src/services/canonSync/naturalEarthSource.ts` | NE GeoJSON fetch (cached) + normalize | **Create** |
| `backend/src/services/canonSync/naturalEarthSource.test.ts` | Normalizer tests (fixtures) | **Create** |
| `backend/src/services/canonSync/rules.ts` | Pure derivation: sources → CanonDraft | **Create** |
| `backend/src/services/canonSync/rules.test.ts` | Rule tests | **Create** |
| `backend/src/services/canonSync/unitMatching.ts` | Geometric crosswalk + dispute landing (PostGIS) | **Create** |
| `backend/src/services/canonSync/unitMatching.test.ts` | Decision-helper tests | **Create** |
| `backend/src/services/canonSync/loader.ts` | Upserts + matview refresh + diff/report + log | **Create** |
| `backend/src/services/canonSync/loader.test.ts` | Diff + upsert-SQL tests | **Create** |
| `backend/src/services/canonSync/index.ts` | Orchestration: syncCanon / status / cancel | **Create** |
| `backend/src/services/canonSync/index.test.ts` | Guard + cancel tests | **Create** |
| `backend/src/controllers/admin/canonSyncController.ts` | 3 thin handlers | **Create** |
| `backend/src/routes/adminRoutes.ts` | Wire POST/GET/DELETE `/canon/sync` | **Modify** |
| `docs/tech/country-canon.md` | Living doc: data layer + how to run sync | **Create** |
| `docs/decisions/0018-country-canon-user-decides.md` | ADR | **Create** |

---

### Task 1: Canon DDL (tables + materialized view)

**Files:**
- Modify: `db/init/01-schema.sql` (append immediately before the final `-- Schema Complete` block, after `ai_learned_rules`)

**Interfaces:**
- Produces: tables `countries`, `country_divisions`, `disputed_territories`, `disputed_territory_members`, `disputed_territory_claims`, `disputed_presets`, `disputed_preset_choices`, `user_disputed_preferences`, `canon_sync_logs`; matview `division_canon_map`. All later tasks rely on these exact names/columns.

- [ ] **Step 1: Append the DDL**

```sql
-- =============================================================================
-- Country Canon (docs/tech/planning/country-canon-and-disputes.md)
-- =============================================================================
-- Global registry of countries + disputed territories, derived dynamically
-- from open sources (Wikidata, Natural Earth) by published rules. References
-- only internal administrative_divisions ids — no unit-source codes here.

CREATE TABLE IF NOT EXISTS countries (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,             -- stable across rebuilds: iso2 lowercase or slugified name
    name VARCHAR(255) NOT NULL,
    class TEXT NOT NULL CHECK (class IN ('un_member','un_observer','de_facto','territory','special')),
    iso_alpha2 CHAR(2) UNIQUE,
    iso_alpha3 CHAR(3) UNIQUE,
    m49_code SMALLINT,
    sovereign_id INTEGER REFERENCES countries(id),   -- territories: Greenland -> Denmark
    wikidata_qid VARCHAR(20),
    valid_period DATERANGE NOT NULL DEFAULT '(,)',   -- temporal hook, unused in v1
    description TEXT,
    sources JSONB NOT NULL DEFAULT '[]',             -- provenance: [{source, version, rule}]
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Base coverage: country-level unit of the current unit source -> country
-- (country level = children of the tree roots; roots are continents here).
CREATE TABLE IF NOT EXISTS country_divisions (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    division_id INTEGER NOT NULL UNIQUE REFERENCES administrative_divisions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_country_divisions_country ON country_divisions(country_id);

CREATE TABLE IF NOT EXISTS disputed_territories (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('attribution','existence')),
    subject_country_id INTEGER REFERENCES countries(id),  -- existence: whose statehood is contested
    is_approximate BOOLEAN NOT NULL DEFAULT false,
    wikidata_qid VARCHAR(20),
    description TEXT,
    sources JSONB NOT NULL DEFAULT '[]'
);

-- Dispute = set of units of ANY level; filled geometrically by the sync.
CREATE TABLE IF NOT EXISTS disputed_territory_members (
    id SERIAL PRIMARY KEY,
    dispute_id INTEGER NOT NULL REFERENCES disputed_territories(id) ON DELETE CASCADE,
    division_id INTEGER NOT NULL REFERENCES administrative_divisions(id) ON DELETE CASCADE,
    UNIQUE(dispute_id, division_id)
);
CREATE INDEX IF NOT EXISTS idx_disputed_members_division ON disputed_territory_members(division_id);

CREATE TABLE IF NOT EXISTS disputed_territory_claims (
    id SERIAL PRIMARY KEY,
    dispute_id INTEGER NOT NULL REFERENCES disputed_territories(id) ON DELETE CASCADE,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('controls','claims')),
    note TEXT,
    UNIQUE(dispute_id, country_id)
);

CREATE TABLE IF NOT EXISTS disputed_presets (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS disputed_preset_choices (
    preset_id INTEGER NOT NULL REFERENCES disputed_presets(id) ON DELETE CASCADE,
    dispute_id INTEGER NOT NULL REFERENCES disputed_territories(id) ON DELETE CASCADE,
    counts_as TEXT NOT NULL CHECK (counts_as IN ('country','independent','not_counted')),
    country_id INTEGER REFERENCES countries(id),
    sources JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (preset_id, dispute_id)
);

CREATE TABLE IF NOT EXISTS user_disputed_preferences (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dispute_id INTEGER NOT NULL REFERENCES disputed_territories(id) ON DELETE CASCADE,
    counts_as TEXT NOT NULL CHECK (counts_as IN ('country','independent','not_counted')),
    country_id INTEGER REFERENCES countries(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, dispute_id)
);

CREATE TABLE IF NOT EXISTS canon_sync_logs (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'running',  -- 'running','success','partial','failed','cancelled'
    report JSONB,                          -- CanonSyncReport (diff, unmatched units, disputes)
    source_versions JSONB,                 -- {wikidata: fetchedAt, naturalEarth: url+etag,...}
    triggered_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canon_sync_logs_status ON canon_sync_logs(status) WHERE status = 'running';

COMMENT ON TABLE countries IS 'Country canon: superset registry derived from open sources by published rules';
COMMENT ON TABLE disputed_territories IS 'Disputed territories registry; unit sets landed geometrically from Natural Earth';
COMMENT ON TABLE user_disputed_preferences IS 'Per-user resolution of disputes. SENSITIVE (political opinion) — owner-only, never public, never logged';

-- Every unit -> (base country, dispute-if-inside). Base level = COUNTRY-LEVEL
-- units (children of the continent roots in the current import); children
-- inherit from their country-level ancestor; dispute member subtrees
-- override. Continent roots are supra-units and are NOT in the map; country
-- units without a country_divisions row are absent (they surface in the sync
-- report instead).
CREATE MATERIALIZED VIEW IF NOT EXISTS division_canon_map AS
WITH RECURSIVE division_tree AS (
    SELECT ad.id AS division_id, ad.id AS country_unit_id
    FROM administrative_divisions ad
    WHERE ad.parent_id IN (SELECT r.id FROM administrative_divisions r WHERE r.parent_id IS NULL)
    UNION ALL
    SELECT ad.id, dt.country_unit_id
    FROM administrative_divisions ad
    JOIN division_tree dt ON ad.parent_id = dt.division_id
), dispute_subtree AS (
    SELECT dtm.division_id, dtm.dispute_id
    FROM disputed_territory_members dtm
    UNION ALL
    SELECT ad.id, ds.dispute_id
    FROM administrative_divisions ad
    JOIN dispute_subtree ds ON ad.parent_id = ds.division_id
)
SELECT dt.division_id,
       cd.country_id AS base_country_id,
       (SELECT MIN(ds.dispute_id) FROM dispute_subtree ds
         WHERE ds.division_id = dt.division_id) AS disputed_territory_id
FROM division_tree dt
JOIN country_divisions cd ON cd.division_id = dt.country_unit_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_division_canon_map_division ON division_canon_map(division_id);
CREATE INDEX IF NOT EXISTS idx_division_canon_map_country ON division_canon_map(base_country_id);
```

- [ ] **Step 2: Apply to the running dev DB**

Run: `docker exec -i tyr-ng-db psql -U postgres -d track_regions -f - < db/init/01-schema.sql`
Expected: `CREATE TABLE` × 9, `CREATE MATERIALIZED VIEW`, `CREATE INDEX` lines; **zero errors** (everything is `IF NOT EXISTS`, existing tables untouched).

- [ ] **Step 3: Verify**

Run: `docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "\dt countries" -c "SELECT COUNT(*) FROM division_canon_map;"`
Expected: `countries` table listed; matview count = **0** (no `country_divisions` rows yet).

- [ ] **Step 4: Checkpoint (no-commit mode)**

Show `git diff db/init/01-schema.sql` summary. Proposed message for later: `back: add country canon schema (registry, disputes, presets, prefs, canon map)`. Do NOT commit without explicit OK.

---

### Task 2: Service scaffolding — types, config files, constants

**Files:**
- Create: `backend/src/services/canonSync/types.ts`
- Create: `backend/src/services/canonSync/config/unit-match-overrides.json`
- Create: `backend/src/services/canonSync/config/exceptions.json`

**Interfaces:**
- Produces (consumed by every later task): all types below, `CANON_CACHE_DIR`, `RULES_VERSION`, threshold constants.

- [ ] **Step 1: Write `types.ts`**

```typescript
/**
 * Country canon sync — shared types and constants.
 * Spec: docs/tech/planning/country-canon-and-disputes.md
 *
 * The canon is DERIVED from open sources by the published rules encoded in
 * rules.ts. Only unit-match-overrides.json (unit name matching) and
 * exceptions.json (justified deviations) are manual.
 */
import path from 'path';

export const CANON_CACHE_DIR = path.join(process.cwd(), 'data', 'cache', 'canon');
export const RULES_VERSION = '1';           // bump when rules.ts logic changes

// Geometric matching thresholds (published rule parameters; calibrated in Task 9)
export const ROOT_MATCH_MIN_SHARE = 0.5;    // country-level unit -> NE country assignment
export const DISPUTE_ROOT_SHARE = 0.9;      // dispute covers a whole country-level unit
export const DISPUTE_CHILD_SHARE = 0.5;     // dispute claims a child unit
export const DISPUTE_COVERAGE_OK = 0.95;    // else is_approximate = true

// UN General Assembly non-member observer states, per
// https://www.un.org/en/about-us/non-member-states (unchanged since 2012).
export const UN_OBSERVER_ISO2 = ['VA', 'PS'];

export type CountryClass = 'un_member' | 'un_observer' | 'de_facto' | 'territory' | 'special';
export type DisputeKind = 'attribution' | 'existence';
export type ChoiceCountsAs = 'country' | 'independent' | 'not_counted';

export interface Provenance { source: string; version: string; rule: string }

export interface WikidataCountryRow {
  qid: string;
  label: string;
  iso2: string | null;
  iso3: string | null;
  isoNumeric: number | null;
  isUnMember: boolean;
  hasLimitedRecognition: boolean;
  sovereignQid: string | null;   // P17 when it points to a different entity
  claimedByQids: string[];       // P1336
}

export interface NeCountryFeature {
  name: string;
  iso2: string | null;
  iso3: string | null;           // ISO_A3_EH with ADM0_A3 fallback (NE quirk: ISO_A3 = -99 for FR/NO)
  sovIso3: string | null;
  type: string;                  // 'Sovereign country' | 'Country' | 'Dependency' | 'Disputed' | ...
  wikidataQid: string | null;
  geometry: unknown;             // GeoJSON geometry, passed to PostGIS as-is
}

export interface NeDisputedFeature {
  name: string;
  note: string | null;
  sovIso3: string | null;        // NE de-facto sovereign
  type: string;                  // 'Disputed' | 'Breakaway' | 'Lease' | ...
  wikidataQid: string | null;
  geometry: unknown;
}

export interface CountryDraft {
  slug: string;
  name: string;
  class: CountryClass;
  iso2: string | null;
  iso3: string | null;
  m49: number | null;
  sovereignSlug: string | null;
  wikidataQid: string | null;
  provenance: Provenance[];
}

export interface ClaimDraft { countrySlug: string; role: 'controls' | 'claims'; note: string | null }

export interface DisputeDraft {
  slug: string;
  name: string;
  kind: DisputeKind;
  subjectCountrySlug: string | null;
  claims: ClaimDraft[];
  neFeature: NeDisputedFeature;  // geometry source for unit landing
  wikidataQid: string | null;
  provenance: Provenance[];
}

export interface PresetChoiceDraft {
  disputeSlug: string;
  countsAs: ChoiceCountsAs;
  countrySlug: string | null;
  provenance: Provenance;
}

export interface PresetDraft { slug: string; name: string; isDefault: boolean; choices: PresetChoiceDraft[] }

export interface CanonDraft {
  countries: CountryDraft[];
  disputes: DisputeDraft[];
  presets: PresetDraft[];
  warnings: string[];            // suspected duplicates etc. — shown in report
}

export interface UnitMatchOverride {
  divisionName: string;
  rootName?: string;             // disambiguator: names repeat across continents (Antarctic claims)
  countrySlug: string;
  reason: string;
}

export type CanonExceptionAction =
  | { setClass: CountryClass }
  | { dropCountry: true }
  | { dropDispute: true }
  | { mergeInto: string };       // slug of the surviving country entry

export interface CanonException { target: string; action: CanonExceptionAction; justification: string; source: string }

export interface CanonSyncReport {
  countriesTotal: number;
  added: string[];
  removed: string[];
  changed: string[];
  unmatchedRootUnits: { id: number; name: string }[];
  disputes: { slug: string; unitCount: number; approximate: boolean }[];
  warnings: string[];
  sourceVersions: Record<string, string>;
}

export interface CanonSyncProgress {
  cancel: boolean;
  status: 'fetching' | 'deriving' | 'matching' | 'loading' | 'complete' | 'failed' | 'cancelled';
  statusMessage: string;
  startedAt: string;
  logId: number | null;
  report: CanonSyncReport | null;
}
```

- [ ] **Step 2: Write the two config skeletons**

`backend/src/services/canonSync/config/unit-match-overrides.json`:
```json
{
  "$comment": "Manual matches of country-level units of the CURRENT unit source (GADM today; children of the continent roots) to canon country slugs. Optional rootName disambiguates duplicate names (Antarctic claims). Matching-only — never membership. Filled during calibration (Task 9).",
  "overrides": []
}
```

`backend/src/services/canonSync/config/exceptions.json`:
```json
{
  "$comment": "Justified deviations from rule output. Target state: empty. Every entry needs justification + source.",
  "exceptions": []
}
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Checkpoint (no-commit mode)** — proposed message: `back: add canonSync types and rule-exception config skeletons`.

---

### Task 3: Wikidata source

**Files:**
- Create: `backend/src/services/canonSync/wikidataSource.ts`
- Test: `backend/src/services/canonSync/wikidataSource.test.ts`

**Interfaces:**
- Consumes: `sparqlQuery`, `extractQid` from `../sync/wikidataUtils.js`; `WikidataCountryRow` from `./types.js`.
- Produces: `fetchWikidataCountries(logPrefix: string): Promise<WikidataCountryRow[]>` and pure `parseWikidataBindings(bindings: SparqlBinding[]): WikidataCountryRow[]`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseWikidataBindings } from './wikidataSource.js';
import type { SparqlBinding } from '../sync/wikidataUtils.js';

const E = 'http://www.wikidata.org/entity/';

function binding(over: Record<string, string | undefined>): SparqlBinding {
  const b: SparqlBinding = {};
  for (const [k, v] of Object.entries(over)) if (v !== undefined) b[k] = { value: v };
  return b;
}

describe('parseWikidataBindings', () => {
  it('parses a UN member with full codes', () => {
    const rows = parseWikidataBindings([binding({
      item: `${E}Q142`, itemLabel: 'France', iso2: 'FR', iso3: 'FRA',
      isoNumeric: '250', unMember: 'true',
    })]);
    expect(rows).toEqual([{
      qid: 'Q142', label: 'France', iso2: 'FR', iso3: 'FRA', isoNumeric: 250,
      isUnMember: true, hasLimitedRecognition: false, sovereignQid: null, claimedByQids: [],
    }]);
  });

  it('aggregates multi-row claimedBy into one entry', () => {
    const rows = parseWikidataBindings([
      binding({ item: `${E}Q1246`, itemLabel: 'Kosovo', iso2: 'XK', limited: 'true', claimedBy: `${E}Q403` }),
      binding({ item: `${E}Q1246`, itemLabel: 'Kosovo', iso2: 'XK', limited: 'true', claimedBy: `${E}Q403` }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].claimedByQids).toEqual(['Q403']);
    expect(rows[0].hasLimitedRecognition).toBe(true);
    expect(rows[0].isUnMember).toBe(false);
  });

  it('keeps sovereign link only when it differs from the entity itself', () => {
    const rows = parseWikidataBindings([
      binding({ item: `${E}Q223`, itemLabel: 'Greenland', iso2: 'GL', sovereign: `${E}Q35` }),
      binding({ item: `${E}Q35`, itemLabel: 'Denmark', iso2: 'DK', unMember: 'true', sovereign: `${E}Q35` }),
    ]);
    expect(rows.find((r) => r.qid === 'Q223')?.sovereignQid).toBe('Q35');
    expect(rows.find((r) => r.qid === 'Q35')?.sovereignQid).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/canonSync/wikidataSource.test.ts`
Expected: FAIL — cannot resolve `./wikidataSource.js`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Wikidata source for the country canon.
 *
 * One SPARQL query pulls every entity matching the membership rule inputs:
 * has an ISO 3166-1 alpha-2 code (P297), OR is a state with limited
 * recognition (P31/P279* Q15634554), OR holds current UN membership
 * (P463 -> Q1065 with no end date). Facts carried per row: ISO codes
 * (P297/P298/P299), UN membership, limited recognition, sovereign state
 * (P17), claimed-by (P1336).
 */
import { sparqlQuery, extractQid, type SparqlBinding } from '../sync/wikidataUtils.js';
import type { WikidataCountryRow } from './types.js';

export const WIKIDATA_COUNTRIES_QUERY = `
SELECT ?item ?itemLabel ?iso2 ?iso3 ?isoNumeric ?unMember ?limited ?sovereign ?claimedBy WHERE {
  {
    { ?item wdt:P297 [] }
    UNION { ?item wdt:P31/wdt:P279* wd:Q15634554 . }
    UNION { ?item p:P463 ?un . ?un ps:P463 wd:Q1065 . FILTER NOT EXISTS { ?un pq:P582 [] } }
  }
  OPTIONAL { ?item wdt:P297 ?iso2 . }
  OPTIONAL { ?item wdt:P298 ?iso3 . }
  OPTIONAL { ?item wdt:P299 ?isoNumeric . }
  OPTIONAL {
    ?item p:P463 ?unSt . ?unSt ps:P463 wd:Q1065 .
    FILTER NOT EXISTS { ?unSt pq:P582 [] }
    BIND(true AS ?unMember)
  }
  OPTIONAL { ?item wdt:P31/wdt:P279* wd:Q15634554 . BIND(true AS ?limited) }
  OPTIONAL { ?item wdt:P17 ?sovereign . }
  OPTIONAL { ?item wdt:P1336 ?claimedBy . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

function rowFromBinding(b: SparqlBinding): WikidataCountryRow {
  const qid = extractQid(b.item?.value ?? '');
  const sovereignQid = b.sovereign ? extractQid(b.sovereign.value) : null;
  return {
    qid,
    label: b.itemLabel?.value ?? qid,
    iso2: b.iso2?.value ?? null,
    iso3: b.iso3?.value ?? null,
    isoNumeric: b.isoNumeric ? Number(b.isoNumeric.value) : null,
    isUnMember: b.unMember?.value === 'true',
    hasLimitedRecognition: b.limited?.value === 'true',
    sovereignQid: sovereignQid === qid ? null : sovereignQid,
    claimedByQids: [],
  };
}

/** Pure: SPARQL bindings (one row per item×claimedBy) -> deduped country rows. */
export function parseWikidataBindings(bindings: SparqlBinding[]): WikidataCountryRow[] {
  const byQid = new Map<string, WikidataCountryRow>();
  for (const b of bindings) {
    if (!b.item) continue;
    const qid = extractQid(b.item.value);
    const existing = byQid.get(qid);
    const row = existing ?? rowFromBinding(b);
    if (!existing) byQid.set(qid, row);
    // Merge multi-valued facts across rows of the same item
    if (b.unMember?.value === 'true') row.isUnMember = true;
    if (b.limited?.value === 'true') row.hasLimitedRecognition = true;
    const claimant = b.claimedBy ? extractQid(b.claimedBy.value) : null;
    if (claimant && !row.claimedByQids.includes(claimant)) row.claimedByQids.push(claimant);
  }
  return [...byQid.values()];
}

export async function fetchWikidataCountries(logPrefix: string): Promise<WikidataCountryRow[]> {
  const bindings = await sparqlQuery(WIKIDATA_COUNTRIES_QUERY, logPrefix);
  return parseWikidataBindings(bindings);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/canonSync/wikidataSource.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Verify the live query shape (manual, once)**

Run:
```bash
curl -s -G 'https://query.wikidata.org/sparql' \
  -H 'Accept: application/sparql-results+json' \
  -H 'User-Agent: TrackYourRegions/1.0 (canon calibration)' \
  --data-urlencode query='SELECT (COUNT(DISTINCT ?item) AS ?n) WHERE {
    { ?item wdt:P297 [] }
    UNION { ?item wdt:P31/wdt:P279* wd:Q15634554 . }
    UNION { ?item p:P463 ?un . ?un ps:P463 wd:Q1065 . FILTER NOT EXISTS { ?un pq:P582 [] } } }' \
  | head -c 400
```
Expected: a count in the **250–290** range (249 ISO + ~10 limited-recognition + historical-ISO stragglers). If wildly off (thousands), the P31/P279* union leg is over-matching — constrain it to direct `wdt:P31 wd:Q15634554` and note the change in the file's doc comment.

- [ ] **Step 6: Checkpoint (no-commit mode)** — proposed message: `back: add canonSync Wikidata source (membership-rule query + parser)`.

---

### Task 4: Natural Earth source

**Files:**
- Create: `backend/src/services/canonSync/naturalEarthSource.ts`
- Test: `backend/src/services/canonSync/naturalEarthSource.test.ts`

**Interfaces:**
- Consumes: `FileCache` from `../wikivoyageExtract/cache.js`; `CANON_CACHE_DIR`, `NeCountryFeature`, `NeDisputedFeature` from `./types.js`.
- Produces: `fetchNeCountries(): Promise<NeCountryFeature[]>`, `fetchNeDisputed(): Promise<NeDisputedFeature[]>`, pure `normalizeNeCountry(props, geometry)`, `normalizeNeDisputed(props, geometry)`, `NE_SOURCE_VERSION` (the URLs used).

- [ ] **Step 1: Verify the actual NE files & fields (manual, once — adjust constants to reality)**

```bash
for f in ne_10m_admin_0_countries ne_10m_admin_0_disputed_areas ne_10m_admin_0_breakaway_disputed_areas; do
  echo "== $f: $(curl -s -o /dev/null -w '%{http_code}' "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson")"
done
```
Expected: `ne_10m_admin_0_countries` → 200; exactly one of the two disputed names → 200 (NE has renamed this layer between releases). Then inspect fields of the ones that answered 200:
```bash
curl -s https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/<disputed-file>.geojson | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const g=JSON.parse(d);console.log(g.features.length);console.log(Object.keys(g.features[0].properties).join(','));console.log(g.features.slice(0,5).map(f=>f.properties.NAME||f.properties.BRK_NAME).join(' | '))})"
```
Record: the working disputed-layer URL, the property names for name (`NAME`/`BRK_NAME`), note (`NOTE_BRK`), sovereign (`SOV_A3`/`ADM0_A3`), type (`TYPE`/`FCLASS`), Wikidata id (`WIKIDATAID`). **Adjust the constants in Step 3 to the observed names** — the code below uses the most common ones with fallbacks.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeNeCountry, normalizeNeDisputed } from './naturalEarthSource.js';

describe('normalizeNeCountry', () => {
  it('prefers ISO_A3_EH over the -99 ISO_A3 quirk (France case)', () => {
    const f = normalizeNeCountry(
      { ADMIN: 'France', ISO_A2_EH: 'FR', ISO_A3: '-99', ISO_A3_EH: 'FRA', SOV_A3: 'FR1', TYPE: 'Country', WIKIDATAID: 'Q142' },
      { type: 'MultiPolygon', coordinates: [] },
    );
    expect(f.iso3).toBe('FRA');
    expect(f.iso2).toBe('FR');
    expect(f.wikidataQid).toBe('Q142');
  });

  it('falls back to ADM0_A3 when both ISO fields are -99', () => {
    const f = normalizeNeCountry(
      { ADMIN: 'Kosovo', ISO_A2_EH: '-99', ISO_A3: '-99', ISO_A3_EH: '-99', ADM0_A3: 'KOS', SOV_A3: 'KOS', TYPE: 'Disputed' },
      { type: 'MultiPolygon', coordinates: [] },
    );
    expect(f.iso3).toBe('KOS');
    expect(f.iso2).toBeNull();
  });
});

describe('normalizeNeDisputed', () => {
  it('extracts name, note, sovereign and QID', () => {
    const f = normalizeNeDisputed(
      { BRK_NAME: 'Crimea', NOTE_BRK: 'Admin. by Russia; claimed by Ukraine', SOV_A3: 'RUS', TYPE: 'Disputed', WIKIDATAID: 'Q7835' },
      { type: 'MultiPolygon', coordinates: [] },
    );
    expect(f).toMatchObject({ name: 'Crimea', sovIso3: 'RUS', type: 'Disputed', wikidataQid: 'Q7835' });
    expect(f.note).toContain('claimed by Ukraine');
  });
});
```

- [ ] **Step 3: Implement**

```typescript
/**
 * Natural Earth source: admin-0 countries + disputed/breakaway areas.
 * Public-domain GeoJSON from the natural-earth-vector repo, fetched with a
 * FileCache under data/cache/canon/ (untracked runtime cache).
 *
 * URLs/fields verified against the live repo in plan Task 4 Step 1 — update
 * NE_DISPUTED_URL and the property fallbacks there if NE renames them.
 */
import path from 'path';
import { FileCache } from '../wikivoyageExtract/cache.js';
import { CANON_CACHE_DIR, type NeCountryFeature, type NeDisputedFeature } from './types.js';

const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
export const NE_COUNTRIES_URL = `${NE_BASE}/ne_10m_admin_0_countries.geojson`;
export const NE_DISPUTED_URL = `${NE_BASE}/ne_10m_admin_0_disputed_areas.geojson`;
export const NE_SOURCE_VERSION = 'natural-earth-vector@master (10m)';

type NeProps = Record<string, unknown>;
interface NeRawFeature { properties: NeProps; geometry: unknown }

const cache = new FileCache(path.join(CANON_CACHE_DIR, 'natural-earth.json'));

function str(props: NeProps, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string' && v && v !== '-99') return v;
  }
  return null;
}

export function normalizeNeCountry(props: NeProps, geometry: unknown): NeCountryFeature {
  return {
    name: str(props, 'ADMIN', 'NAME') ?? 'Unknown',
    iso2: str(props, 'ISO_A2_EH', 'ISO_A2'),
    iso3: str(props, 'ISO_A3_EH', 'ISO_A3', 'ADM0_A3'),
    sovIso3: str(props, 'SOV_A3'),
    type: str(props, 'TYPE', 'FCLASS') ?? 'Unknown',
    wikidataQid: str(props, 'WIKIDATAID'),
    geometry,
  };
}

export function normalizeNeDisputed(props: NeProps, geometry: unknown): NeDisputedFeature {
  return {
    name: str(props, 'BRK_NAME', 'NAME') ?? 'Unknown',
    note: str(props, 'NOTE_BRK', 'NOTE_ADM0'),
    sovIso3: str(props, 'SOV_A3', 'ADM0_A3'),
    type: str(props, 'TYPE', 'FCLASS') ?? 'Unknown',
    wikidataQid: str(props, 'WIKIDATAID'),
    geometry,
  };
}

async function fetchGeojson(url: string): Promise<NeRawFeature[]> {
  const key = FileCache.buildKey({ url });
  if (cache.has(key)) {
    return (cache.get(key) as { features: NeRawFeature[] }).features;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Natural Earth fetch failed ${res.status}: ${url}`);
  const data = await res.json() as { features: NeRawFeature[] };
  cache.set(key, data);
  cache.save();
  return data.features;
}

export async function fetchNeCountries(): Promise<NeCountryFeature[]> {
  const features = await fetchGeojson(NE_COUNTRIES_URL);
  return features.map((f) => normalizeNeCountry(f.properties, f.geometry));
}

export async function fetchNeDisputed(): Promise<NeDisputedFeature[]> {
  const features = await fetchGeojson(NE_DISPUTED_URL);
  return features.map((f) => normalizeNeDisputed(f.properties, f.geometry));
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run src/services/canonSync/naturalEarthSource.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Checkpoint (no-commit mode)** — proposed message: `back: add canonSync Natural Earth source (countries + disputed layers)`.

---

### Task 5: Derivation rules (the published rules, as code)

**Files:**
- Create: `backend/src/services/canonSync/rules.ts`
- Test: `backend/src/services/canonSync/rules.test.ts`

**Interfaces:**
- Consumes: every type from `./types.js`.
- Produces: `deriveCanon(input: { wikidata: WikidataCountryRow[]; neCountries: NeCountryFeature[]; neDisputed: NeDisputedFeature[]; exceptions: CanonException[] }): CanonDraft`; helper `slugify(name: string): string`.

**Rules implemented (verbatim from the spec):**
1. Membership: row enters ⇔ has ISO code ∨ UN member ∨ observer ∨ limited recognition.
2. Class: `un_member` (UN) → `un_observer` (`UN_OBSERVER_ISO2`) → `de_facto` (limited recognition) → `territory` (has sovereign) → `special` (ISO entry, no sovereign, none of the above — Antarctica falls out of the rule, not a hardcode).
3. Slug: `iso2.toLowerCase()` else `slugify(label)`; dedupe by iso2 (first Wikidata row wins, warning on collision).
4. Disputes: one per NE disputed feature; `kind` = `existence` when a canon entry matches the feature (by Wikidata QID or by NE sovIso3 == that entry's iso3) **and that entry's class ∈ {de_facto, un_observer}** (un_member excluded — a match on the controlling UN member must stay `attribution`, e.g. Crimea/RUS), else `attribution`. *(Erratum 2026-07-18: the original `de_facto`-only gate made the un-preset's observer branch unreachable — caught in task review; Палестина-observer requires existence.)*
5. Claims: `controls` = country matching NE `sovIso3` (or the subject itself for self-sovereign breakaways); `claims` = countries matching the subject's Wikidata `claimedByQids`.
6. Presets: `de_facto` (default; controller wins / breakaway counts `independent`), `un_widely_recognized` (existence → `independent` iff subject is `un_member`/`un_observer`, else toward the `claims` claimant; attribution → toward the `claims` claimant, falling back to controller), `strict_neutral` (everything `not_counted`).
7. Exceptions applied last, each stamped into provenance. *(Erratum 2026-07-18, from task review: `dropCountry`/`mergeInto` must CASCADE — mergeInto redirects all slug references (dispute subjects, claims, preset choices, sovereign links) to the survivor and dedupes claims; dropCountry purges its claims (dispute left claimless → dropped with warning), drops disputes whose subject was removed, downgrades preset choices pointing at it to `not_counted`, and nulls sovereign links — each with a warning. Self-referential mergeInto is a warned no-op. `deriveCanon` no longer takes `neCountries` (unused — geometry lives in unitMatching); `buildCountries` warns when a `sovereignQid` cannot be resolved.)*

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { deriveCanon, slugify } from './rules.js';
import type { NeCountryFeature, NeDisputedFeature, WikidataCountryRow } from './types.js';

function wd(over: Partial<WikidataCountryRow>): WikidataCountryRow {
  return {
    qid: 'Q0', label: 'X', iso2: null, iso3: null, isoNumeric: null,
    isUnMember: false, hasLimitedRecognition: false, sovereignQid: null, claimedByQids: [],
    ...over,
  };
}
const GEO = { type: 'MultiPolygon', coordinates: [] };
function nec(over: Partial<NeCountryFeature>): NeCountryFeature {
  return { name: 'X', iso2: null, iso3: null, sovIso3: null, type: 'Country', wikidataQid: null, geometry: GEO, ...over };
}
function ned(over: Partial<NeDisputedFeature>): NeDisputedFeature {
  return { name: 'X', note: null, sovIso3: null, type: 'Disputed', wikidataQid: null, geometry: GEO, ...over };
}

const FRANCE = wd({ qid: 'Q142', label: 'France', iso2: 'FR', iso3: 'FRA', isoNumeric: 250, isUnMember: true });
const DENMARK = wd({ qid: 'Q35', label: 'Denmark', iso2: 'DK', iso3: 'DNK', isUnMember: true });
const GREENLAND = wd({ qid: 'Q223', label: 'Greenland', iso2: 'GL', iso3: 'GRL', sovereignQid: 'Q35' });
const VATICAN = wd({ qid: 'Q237', label: 'Vatican City', iso2: 'VA', iso3: 'VAT' });
const ANTARCTICA = wd({ qid: 'Q51', label: 'Antarctica', iso2: 'AQ', iso3: 'ATA' });
const SERBIA = wd({ qid: 'Q403', label: 'Serbia', iso2: 'RS', iso3: 'SRB', isUnMember: true });
const KOSOVO = wd({ qid: 'Q1246', label: 'Kosovo', iso2: 'XK', hasLimitedRecognition: true, claimedByQids: ['Q403'] });
const UKRAINE = wd({ qid: 'Q212', label: 'Ukraine', iso2: 'UA', iso3: 'UKR', isUnMember: true });
const RUSSIA = wd({ qid: 'Q159', label: 'Russia', iso2: 'RU', iso3: 'RUS', isUnMember: true });

function derive(extra: {
  wikidata?: WikidataCountryRow[]; neCountries?: NeCountryFeature[]; neDisputed?: NeDisputedFeature[];
} = {}) {
  return deriveCanon({
    wikidata: extra.wikidata ?? [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA],
    neCountries: extra.neCountries ?? [nec({ name: 'Kosovo', iso3: 'KOS', sovIso3: 'KOS', wikidataQid: 'Q1246' })],
    neDisputed: extra.neDisputed ?? [],
    exceptions: [],
  });
}

describe('deriveCanon — classes (rule 2)', () => {
  it('classifies by the published class rule, with Antarctica falling out as special', () => {
    const d = derive();
    const byslug = new Map(d.countries.map((c) => [c.slug, c]));
    expect(byslug.get('fr')?.class).toBe('un_member');
    expect(byslug.get('va')?.class).toBe('un_observer');
    expect(byslug.get('xk')?.class).toBe('de_facto');
    expect(byslug.get('gl')?.class).toBe('territory');
    expect(byslug.get('gl')?.sovereignSlug).toBe('dk');
    expect(byslug.get('aq')?.class).toBe('special');
  });

  it('stamps provenance with source and rule on every entry', () => {
    const fr = derive().countries.find((c) => c.slug === 'fr');
    expect(fr?.provenance.some((p) => p.source === 'wikidata' && p.rule.includes('un_member'))).toBe(true);
  });
});

describe('deriveCanon — disputes (rules 4-5)', () => {
  it('builds an existence dispute for a breakaway matched to a de_facto entry', () => {
    const d = derive({
      neDisputed: [ned({ name: 'Kosovo', sovIso3: 'KOS', wikidataQid: 'Q1246' })],
    });
    const k = d.disputes.find((x) => x.slug === 'kosovo');
    expect(k?.kind).toBe('existence');
    expect(k?.subjectCountrySlug).toBe('xk');
    expect(k?.claims).toContainEqual({ countrySlug: 'rs', role: 'claims', note: null });
  });

  it('builds an attribution dispute with the NE sovereign as controller', () => {
    const crimeaWd = wd({ qid: 'Q7835', label: 'Crimea', claimedByQids: ['Q212'] });
    const d = derive({
      wikidata: [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA, crimeaWd],
      neDisputed: [ned({ name: 'Crimea', sovIso3: 'RUS', wikidataQid: 'Q7835' })],
    });
    const c = d.disputes.find((x) => x.slug === 'crimea');
    expect(c?.kind).toBe('attribution');
    expect(c?.claims).toContainEqual({ countrySlug: 'ru', role: 'controls', note: null });
    expect(c?.claims).toContainEqual({ countrySlug: 'ua', role: 'claims', note: null });
  });
});

describe('deriveCanon — presets (rule 6)', () => {
  it('derives de_facto (default), un_widely_recognized and strict_neutral', () => {
    const d = derive({
      neDisputed: [ned({ name: 'Kosovo', sovIso3: 'KOS', wikidataQid: 'Q1246' })],
    });
    const presets = new Map(d.presets.map((p) => [p.slug, p]));
    expect(presets.get('de_facto')?.isDefault).toBe(true);
    const defactoKosovo = presets.get('de_facto')?.choices.find((c) => c.disputeSlug === 'kosovo');
    expect(defactoKosovo?.countsAs).toBe('independent');
    const unKosovo = presets.get('un_widely_recognized')?.choices.find((c) => c.disputeSlug === 'kosovo');
    expect(unKosovo).toMatchObject({ countsAs: 'country', countrySlug: 'rs' });
    const neutral = presets.get('strict_neutral')?.choices.find((c) => c.disputeSlug === 'kosovo');
    expect(neutral?.countsAs).toBe('not_counted');
  });
});

describe('deriveCanon — exceptions (rule 7)', () => {
  it('applies a class override and stamps provenance', () => {
    const d = deriveCanon({
      wikidata: [FRANCE, GREENLAND, DENMARK],
      neCountries: [], neDisputed: [],
      exceptions: [{ target: 'gl', action: { setClass: 'de_facto' }, justification: 'test', source: 'test' }],
    });
    const gl = d.countries.find((c) => c.slug === 'gl');
    expect(gl?.class).toBe('de_facto');
    expect(gl?.provenance.some((p) => p.source === 'exceptions.json')).toBe(true);
  });

  it('merges duplicate entries via mergeInto', () => {
    const sadr = wd({ qid: 'Q40362', label: 'Sahrawi Arab Democratic Republic', hasLimitedRecognition: true });
    const wsah = wd({ qid: 'Q6250', label: 'Western Sahara', iso2: 'EH', iso3: 'ESH' });
    const d = deriveCanon({
      wikidata: [wsah, sadr], neCountries: [], neDisputed: [],
      exceptions: [{ target: 'sahrawi-arab-democratic-republic', action: { mergeInto: 'eh' }, justification: 'same territory', source: 'test' }],
    });
    expect(d.countries.find((c) => c.slug === 'sahrawi-arab-democratic-republic')).toBeUndefined();
    expect(d.countries.find((c) => c.slug === 'eh')).toBeDefined();
  });
});

describe('slugify', () => {
  it('lowercases, strips diacritics, hyphenates', () => {
    expect(slugify('São Tomé and Príncipe')).toBe('sao-tome-and-principe');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/canonSync/rules.test.ts`
Expected: FAIL — cannot resolve `./rules.js`.

- [ ] **Step 3: Implement `rules.ts`**

```typescript
/**
 * The published derivation rules for the country canon. Pure functions —
 * sources in, CanonDraft out. THIS FILE IS THE METHODOLOGY the user-facing
 * "Where does this list come from" page describes; keep rule text in
 * provenance strings in sync with any logic change (bump RULES_VERSION).
 */
import {
  RULES_VERSION, UN_OBSERVER_ISO2,
  type CanonDraft, type CanonException, type ClaimDraft, type CountryClass, type CountryDraft,
  type DisputeDraft, type NeCountryFeature, type NeDisputedFeature, type PresetChoiceDraft,
  type PresetDraft, type Provenance, type WikidataCountryRow,
} from './types.js';

export function slugify(name: string): string {
  // Strip combining diacritics (U+0300-U+036F) after NFD decomposition
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function prov(source: string, rule: string, version = RULES_VERSION): Provenance {
  return { source, version, rule };
}

function classify(row: WikidataCountryRow): { cls: CountryClass; rule: string } | null {
  if (row.isUnMember) return { cls: 'un_member', rule: 'un_member: current UN membership (P463->Q1065, no end date)' };
  if (row.iso2 && UN_OBSERVER_ISO2.includes(row.iso2)) {
    return { cls: 'un_observer', rule: 'un_observer: UN GA observer list (un.org non-member states)' };
  }
  if (row.hasLimitedRecognition) return { cls: 'de_facto', rule: 'de_facto: state with limited recognition (P31 Q15634554)' };
  if (row.iso2 && row.sovereignQid) return { cls: 'territory', rule: 'territory: ISO entry with sovereign (P17)' };
  if (row.iso2) return { cls: 'special', rule: 'special: ISO entry, no sovereign, not UN, not limited-recognition' };
  return null; // fails the membership rule entirely
}

function buildCountries(wikidata: WikidataCountryRow[], warnings: string[]): CountryDraft[] {
  const byIso2 = new Map<string, CountryDraft>();
  const drafts: CountryDraft[] = [];
  const byQid = new Map<string, CountryDraft>();
  for (const row of wikidata) {
    const classified = classify(row);
    if (!classified) continue;
    const slug = row.iso2 ? row.iso2.toLowerCase() : slugify(row.label);
    if (row.iso2 && byIso2.has(row.iso2)) {
      warnings.push(`duplicate iso2 ${row.iso2}: kept ${byIso2.get(row.iso2)?.name}, dropped ${row.label} (${row.qid})`);
      continue;
    }
    const draft: CountryDraft = {
      slug, name: row.label, class: classified.cls,
      iso2: row.iso2, iso3: row.iso3, m49: row.isoNumeric,
      sovereignSlug: null, // resolved below once all rows are in
      wikidataQid: row.qid,
      provenance: [prov('wikidata', classified.rule)],
    };
    drafts.push(draft);
    byQid.set(row.qid, draft);
    if (row.iso2) byIso2.set(row.iso2, draft);
  }
  // Second pass: sovereign links (qid -> slug)
  for (const row of wikidata) {
    const draft = byQid.get(row.qid);
    if (draft && row.sovereignQid) draft.sovereignSlug = byQid.get(row.sovereignQid)?.slug ?? null;
  }
  return drafts;
}

interface CountryIndex {
  bySlug: Map<string, CountryDraft>;
  byIso3: Map<string, CountryDraft>;
  byQid: Map<string, CountryDraft>;
}
function indexCountries(countries: CountryDraft[]): CountryIndex {
  return {
    bySlug: new Map(countries.map((c) => [c.slug, c])),
    byIso3: new Map(countries.filter((c) => c.iso3).map((c) => [c.iso3 as string, c])),
    byQid: new Map(countries.filter((c) => c.wikidataQid).map((c) => [c.wikidataQid as string, c])),
  };
}

function buildDisputes(
  neDisputed: NeDisputedFeature[], idx: CountryIndex,
  wikidataByQid: Map<string, WikidataCountryRow>, warnings: string[],
): DisputeDraft[] {
  const out: DisputeDraft[] = [];
  for (const f of neDisputed) {
    const slug = slugify(f.name);
    if (out.some((d) => d.slug === slug)) { warnings.push(`duplicate NE disputed feature ${slug} — kept first`); continue; }
    // Subject: a canon entry this feature IS (existence), matched by QID or by NE self-sovereignty
    const byQid = f.wikidataQid ? idx.byQid.get(f.wikidataQid) : undefined;
    const bySov = f.sovIso3 ? idx.byIso3.get(f.sovIso3) : undefined;
    const subject = byQid && byQid.class === 'de_facto' ? byQid
      : bySov && bySov.class === 'de_facto' ? bySov : null;
    const kind = subject ? 'existence' as const : 'attribution' as const;

    const claims: ClaimDraft[] = [];
    const controller = subject ?? (f.sovIso3 ? idx.byIso3.get(f.sovIso3) ?? null : null);
    if (controller) claims.push({ countrySlug: controller.slug, role: 'controls', note: null });
    const subjectRow = subject?.wikidataQid ? wikidataByQid.get(subject.wikidataQid) : undefined;
    const featureRow = f.wikidataQid ? wikidataByQid.get(f.wikidataQid) : undefined;
    for (const claimantQid of [...(subjectRow?.claimedByQids ?? []), ...(featureRow?.claimedByQids ?? [])]) {
      const claimant = idx.byQid.get(claimantQid);
      if (claimant && !claims.some((c) => c.countrySlug === claimant.slug)) {
        claims.push({ countrySlug: claimant.slug, role: 'claims', note: null });
      }
    }
    if (claims.length === 0) { warnings.push(`dispute ${slug}: no claimants resolved — dropped (add exception if it must exist)`); continue; }
    out.push({
      slug, name: f.name, kind, subjectCountrySlug: subject?.slug ?? null,
      claims, neFeature: f, wikidataQid: f.wikidataQid,
      provenance: [prov('natural-earth', `dispute from NE disputed/breakaway layer (type=${f.type})`)],
    });
  }
  return out;
}

function presetChoice(disputeSlug: string, countsAs: PresetChoiceDraft['countsAs'], countrySlug: string | null, source: string, rule: string): PresetChoiceDraft {
  return { disputeSlug, countsAs, countrySlug, provenance: prov(source, rule) };
}

function buildPresets(disputes: DisputeDraft[], idx: CountryIndex): PresetDraft[] {
  const deFacto: PresetDraft = { slug: 'de_facto', name: 'De facto (who controls)', isDefault: true, choices: [] };
  const un: PresetDraft = { slug: 'un_widely_recognized', name: 'UN / widely recognized', isDefault: false, choices: [] };
  const neutral: PresetDraft = { slug: 'strict_neutral', name: 'Strictly neutral', isDefault: false, choices: [] };
  for (const d of disputes) {
    const controller = d.claims.find((c) => c.role === 'controls');
    const claimant = d.claims.find((c) => c.role === 'claims');
    // de_facto: breakaway counts as independent, else controller takes it
    if (d.kind === 'existence' && d.subjectCountrySlug && controller?.countrySlug === d.subjectCountrySlug) {
      deFacto.choices.push(presetChoice(d.slug, 'independent', null, 'natural-earth', 'de_facto: NE shows the breakaway as self-administering'));
    } else if (controller) {
      deFacto.choices.push(presetChoice(d.slug, 'country', controller.countrySlug, 'natural-earth', 'de_facto: NE de-facto sovereign'));
    } else {
      deFacto.choices.push(presetChoice(d.slug, 'not_counted', null, 'rules', 'de_facto: no controller resolved'));
    }
    // un_widely_recognized
    const subject = d.subjectCountrySlug ? idx.bySlug.get(d.subjectCountrySlug) : undefined;
    if (d.kind === 'existence' && subject && (subject.class === 'un_member' || subject.class === 'un_observer')) {
      un.choices.push(presetChoice(d.slug, 'independent', null, 'un', 'un: subject is a UN member/observer'));
    } else if (claimant) {
      un.choices.push(presetChoice(d.slug, 'country', claimant.countrySlug, 'wikidata', 'un: internationally recognized claimant (P1336)'));
    } else if (controller) {
      un.choices.push(presetChoice(d.slug, 'country', controller.countrySlug, 'natural-earth', 'un: no distinct claimant; controller'));
    } else {
      un.choices.push(presetChoice(d.slug, 'not_counted', null, 'rules', 'un: unresolvable'));
    }
    neutral.choices.push(presetChoice(d.slug, 'not_counted', null, 'rules', 'strict_neutral: everything not_counted'));
  }
  return [deFacto, un, neutral];
}

function applyExceptions(draft: CanonDraft, exceptions: CanonException[]): void {
  for (const ex of exceptions) {
    const stamp = prov('exceptions.json', `${ex.justification} (${ex.source})`);
    const country = draft.countries.find((c) => c.slug === ex.target);
    const dispute = draft.disputes.find((d) => d.slug === ex.target);
    if ('setClass' in ex.action && country) {
      country.class = ex.action.setClass; country.provenance.push(stamp);
    } else if ('dropCountry' in ex.action && country) {
      draft.countries = draft.countries.filter((c) => c !== country);
    } else if ('dropDispute' in ex.action && dispute) {
      draft.disputes = draft.disputes.filter((d) => d !== dispute);
      for (const p of draft.presets) p.choices = p.choices.filter((c) => c.disputeSlug !== ex.target);
    } else if ('mergeInto' in ex.action && country) {
      const survivor = draft.countries.find((c) => c.slug === (ex.action as { mergeInto: string }).mergeInto);
      if (survivor) { survivor.provenance.push(stamp); draft.countries = draft.countries.filter((c) => c !== country); }
      else draft.warnings.push(`exception mergeInto ${JSON.stringify(ex.action)}: survivor not found`);
    } else {
      draft.warnings.push(`exception target not found: ${ex.target}`);
    }
  }
}

export function deriveCanon(input: {
  wikidata: WikidataCountryRow[];
  neCountries: NeCountryFeature[];
  neDisputed: NeDisputedFeature[];
  exceptions: CanonException[];
}): CanonDraft {
  const warnings: string[] = [];
  const countries = buildCountries(input.wikidata, warnings);
  const idx = indexCountries(countries);
  const wikidataByQid = new Map(input.wikidata.map((r) => [r.qid, r]));
  const disputes = buildDisputes(input.neDisputed, idx, wikidataByQid, warnings);
  const presets = buildPresets(disputes, idx);
  const draft: CanonDraft = { countries, disputes, presets, warnings };
  applyExceptions(draft, input.exceptions);
  return draft;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/canonSync/rules.test.ts`
Expected: PASS (8 passing).

- [ ] **Step 5: Checkpoint (no-commit mode)** — proposed message: `back: add canon derivation rules (membership, classes, disputes, presets)`.

---

### Task 6: Geometric unit matching (crosswalk + dispute landing)

**Files:**
- Create: `backend/src/services/canonSync/unitMatching.ts`
- Test: `backend/src/services/canonSync/unitMatching.test.ts`

**Interfaces:**
- Consumes: `pool` from `../../db/index.js`; thresholds + `NeCountryFeature`/`NeDisputedFeature`/`UnitMatchOverride` from `./types.js`.
- Produces:
  - `matchRootUnits(neCountries, countries: {slug, iso3}[], overrides): Promise<{ crosswalk: Map<number, string>; unmatched: {id, name}[] }>` — divisionId → countrySlug;
  - `landDisputeUnits(neFeature): Promise<{ divisionIds: number[]; approximate: boolean }>`;
  - pure `pickBestMatch(shares: {slug: string; share: number}[]): string | null` and `decideLanding(rootShare, childShares, coverage)` used by the SQL paths.

- [ ] **Step 1: Write the failing tests (pure decision helpers)**

```typescript
import { describe, it, expect } from 'vitest';
import { pickBestMatch, decideLanding } from './unitMatching.js';

describe('pickBestMatch', () => {
  it('picks the country with max share above the floor', () => {
    expect(pickBestMatch([{ slug: 'fr', share: 0.97 }, { slug: 'es', share: 0.02 }])).toBe('fr');
  });
  it('returns null when nothing clears ROOT_MATCH_MIN_SHARE (0.5)', () => {
    expect(pickBestMatch([{ slug: 'fr', share: 0.3 }, { slug: 'es', share: 0.3 }])).toBeNull();
  });
});

describe('decideLanding', () => {
  it('takes the whole root when the dispute covers it (Kosovo case)', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.98 }, [], 0.99);
    expect(d).toEqual({ divisionIds: [7], approximate: false });
  });
  it('descends to child units when the root share is low (Crimea case)', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.04 }, [
      { id: 71, share: 0.99 }, { id: 72, share: 0.97 }, { id: 73, share: 0.01 },
    ], 0.98);
    expect(d).toEqual({ divisionIds: [71, 72], approximate: false });
  });
  it('flags approximate when selected units cover the NE polygon poorly', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.1 }, [{ id: 71, share: 0.6 }], 0.7);
    expect(d.approximate).toBe(true);
  });
  it('flags approximate when nothing clears the child threshold', () => {
    const d = decideLanding({ rootId: 7, rootShare: 0.1 }, [{ id: 71, share: 0.2 }], 0.2);
    expect(d).toEqual({ divisionIds: [71], approximate: true }); // best-effort: top unit kept
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/canonSync/unitMatching.test.ts`
Expected: FAIL — cannot resolve `./unitMatching.js`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Geometric matching of canon entities to the current unit source
 * (administrative_divisions; GADM today — nothing here depends on its codes).
 *
 * "Country-level units" = children of the tree roots (roots are continents
 * in the current import). Names repeat at this level (Antarctic claim slices
 * are named after claimant countries), so geometry is the primary matcher.
 *
 * Strategy: load NE geometries into a session temp table with a GIST index,
 * then set-based overlap queries. Shares are ST_Area(intersection)/ST_Area(unit).
 */
import { pool } from '../../db/index.js';
import {
  DISPUTE_CHILD_SHARE, DISPUTE_COVERAGE_OK, DISPUTE_ROOT_SHARE, ROOT_MATCH_MIN_SHARE,
  type NeCountryFeature, type NeDisputedFeature, type UnitMatchOverride,
} from './types.js';

export function pickBestMatch(shares: { slug: string; share: number }[]): string | null {
  const best = shares.reduce<{ slug: string; share: number } | null>(
    (acc, s) => (acc === null || s.share > acc.share ? s : acc), null,
  );
  return best && best.share >= ROOT_MATCH_MIN_SHARE ? best.slug : null;
}

export function decideLanding(
  root: { rootId: number; rootShare: number },
  childShares: { id: number; share: number }[],
  coverage: number,
): { divisionIds: number[]; approximate: boolean } {
  if (root.rootShare >= DISPUTE_ROOT_SHARE) {
    return { divisionIds: [root.rootId], approximate: coverage < DISPUTE_COVERAGE_OK };
  }
  const selected = childShares.filter((c) => c.share >= DISPUTE_CHILD_SHARE).map((c) => c.id);
  if (selected.length > 0) return { divisionIds: selected, approximate: coverage < DISPUTE_COVERAGE_OK };
  // Best effort: keep the single most-covered child, marked approximate
  const top = childShares.reduce<{ id: number; share: number } | null>(
    (acc, s) => (acc === null || s.share > acc.share ? s : acc), null,
  );
  return { divisionIds: top ? [top.id] : [], approximate: true };
}

/** Create + fill a temp table of NE country geometries for this connection. */
async function withNeTempTable<T>(
  features: { key: string; geometry: unknown }[],
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // BEGIN must come first: ON COMMIT DROP outside an explicit transaction
    // would drop the temp table at the implicit commit of CREATE itself.
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE canon_ne_tmp (key TEXT PRIMARY KEY, geom GEOMETRY(Geometry, 4326))
      ON COMMIT DROP`);
    for (const f of features) {
      await client.query(
        `INSERT INTO canon_ne_tmp (key, geom)
         VALUES ($1, ST_SetSRID(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($2)), 3), 4326))
         ON CONFLICT (key) DO NOTHING`,
        [f.key, JSON.stringify(f.geometry)],
      );
    }
    await client.query('CREATE INDEX ON canon_ne_tmp USING GIST (geom)');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Root units -> canon countries. NE features are keyed by the country slug
 * they resolved to in rules (iso3 match); overrides win over geometry.
 */
export async function matchRootUnits(
  neCountries: NeCountryFeature[],
  countries: { slug: string; iso3: string | null }[],
  overrides: UnitMatchOverride[],
): Promise<{ crosswalk: Map<number, string>; unmatched: { id: number; name: string }[] }> {
  const iso3ToSlug = new Map(countries.filter((c) => c.iso3).map((c) => [c.iso3 as string, c.slug]));
  const keyed = neCountries
    .filter((f) => f.iso3 && iso3ToSlug.has(f.iso3))
    .map((f) => ({ key: iso3ToSlug.get(f.iso3 as string) as string, geometry: f.geometry }));

  const rows = await withNeTempTable(keyed, async (client) => {
    const res = await client.query(`
      SELECT ad.id, ad.name, t.key AS slug,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(ad.geom), 0) AS share
      FROM administrative_divisions ad
      JOIN canon_ne_tmp t ON ad.geom && t.geom
      WHERE ad.parent_id IN (SELECT r.id FROM administrative_divisions r WHERE r.parent_id IS NULL)
        AND ad.geom IS NOT NULL`);
    return res.rows as { id: number; name: string; slug: string; share: number }[];
  });

  const byUnit = new Map<number, { name: string; shares: { slug: string; share: number }[] }>();
  for (const r of rows) {
    const e = byUnit.get(r.id) ?? { name: r.name, shares: [] };
    e.shares.push({ slug: r.slug, share: Number(r.share) || 0 });
    byUnit.set(r.id, e);
  }

  const allCountryUnits = await pool.query(`
    SELECT ad.id, ad.name, r.name AS root_name
    FROM administrative_divisions ad
    JOIN administrative_divisions r ON ad.parent_id = r.id
    WHERE r.parent_id IS NULL`);
  const crosswalk = new Map<number, string>();
  const unmatched: { id: number; name: string }[] = [];
  for (const unit of allCountryUnits.rows as { id: number; name: string; root_name: string }[]) {
    const override = overrides.find((o) =>
      o.divisionName.toLowerCase() === unit.name.toLowerCase()
      && (!o.rootName || o.rootName.toLowerCase() === unit.root_name.toLowerCase()));
    const picked = override?.countrySlug ?? pickBestMatch(byUnit.get(unit.id)?.shares ?? []);
    if (picked) crosswalk.set(unit.id, picked);
    else unmatched.push({ id: unit.id, name: `${unit.root_name} / ${unit.name}` });
  }
  return { crosswalk, unmatched };
}

/** Land one dispute's NE polygon on units: whole root, else child units. */
export async function landDisputeUnits(
  neFeature: NeDisputedFeature,
): Promise<{ divisionIds: number[]; approximate: boolean }> {
  return withNeTempTable([{ key: 'dispute', geometry: neFeature.geometry }], async (client) => {
    const roots = await client.query(`
      SELECT ad.id,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(ad.geom), 0) AS share,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(t.geom), 0) AS coverage
      FROM administrative_divisions ad, canon_ne_tmp t
      WHERE ad.parent_id IN (SELECT r.id FROM administrative_divisions r WHERE r.parent_id IS NULL)
        AND ad.geom && t.geom
      ORDER BY share DESC LIMIT 1`);
    if (roots.rows.length === 0) return { divisionIds: [], approximate: true };
    const root = roots.rows[0] as { id: number; share: number; coverage: number };

    const children = await client.query(`
      SELECT ad.id,
             ST_Area(ST_Intersection(ad.geom, t.geom)) / NULLIF(ST_Area(ad.geom), 0) AS share
      FROM administrative_divisions ad, canon_ne_tmp t
      WHERE ad.parent_id = $1 AND ad.geom && t.geom`, [root.id]);
    const childShares = (children.rows as { id: number; share: number }[])
      .map((c) => ({ id: c.id, share: Number(c.share) || 0 }));

    const selectedForCoverage = childShares.filter((c) => c.share >= DISPUTE_CHILD_SHARE).map((c) => c.id);
    const coverageIds = Number(root.share) >= DISPUTE_ROOT_SHARE ? [root.id] : selectedForCoverage;
    let coverage = Number(root.coverage) || 0;
    if (coverageIds.length > 0 && Number(root.share) < DISPUTE_ROOT_SHARE) {
      const cov = await client.query(`
        SELECT ST_Area(ST_Intersection(ST_Union(ad.geom), t.geom)) / NULLIF(ST_Area(t.geom), 0) AS coverage
        FROM administrative_divisions ad, canon_ne_tmp t
        WHERE ad.id = ANY($1)`, [coverageIds]);
      coverage = Number((cov.rows[0] as { coverage: number }).coverage) || 0;
    }
    return decideLanding({ rootId: root.id, rootShare: Number(root.share) || 0 }, childShares, coverage);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/canonSync/unitMatching.test.ts`
Expected: PASS (6 passing). (SQL paths are exercised for real in Task 9.)

- [ ] **Step 5: Checkpoint (no-commit mode)** — proposed message: `back: add geometric unit matching for canon (crosswalk + dispute landing)`.

---

### Task 7: Loader (upserts, matview refresh, diff, log)

> **Erratum 2026-07-18 (from task review; reference code below predates it):**
> the shipped loader must additionally (1) run the whole `loadCanon` body in
> ONE transaction (`pool.connect()` + BEGIN/COMMIT/ROLLBACK; helpers take the
> client); (2) delete stale countries only AFTER disputes/presets are rebuilt;
> (3) NEVER delete a country or dispute still referenced by
> `user_disputed_preferences` — retain it inert (no coverage/members) with a
> warning in the report (prefs are user data; the CASCADE on dispute_id must
> never fire from the loader); (4) refuse to load an empty `draft.countries`
> (abort before any mutation) and warn on empty `draft.disputes`; (5) delete
> stale `disputed_presets` symmetrically (their choices cascade).

**Files:**
- Create: `backend/src/services/canonSync/loader.ts`
- Test: `backend/src/services/canonSync/loader.test.ts`

**Interfaces:**
- Consumes: `pool`; `CanonDraft`, `CanonSyncReport` from `./types.js`.
- Produces:
  - pure `diffCanon(prev: { slug: string; fingerprint: string }[], draft: CanonDraft): { added: string[]; removed: string[]; changed: string[] }` with `fingerprintCountry(c: CountryDraft): string`;
  - `loadCanon(draft, crosswalk: Map<number, string>, disputeUnits: Map<string, { divisionIds: number[]; approximate: boolean }>, sourceVersions: Record<string, string>): Promise<CanonSyncReport>`;
  - `createCanonSyncLog(triggeredBy: number | null): Promise<number>`, `finishCanonSyncLog(logId, status, report): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { pool } from '../../db/index.js';
import { diffCanon, fingerprintCountry, loadCanon } from './loader.js';
import type { CanonDraft, CountryDraft } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function country(over: Partial<CountryDraft>): CountryDraft {
  return {
    slug: 'fr', name: 'France', class: 'un_member', iso2: 'FR', iso3: 'FRA', m49: 250,
    sovereignSlug: null, wikidataQid: 'Q142', provenance: [], ...over,
  };
}
function draft(countries: CountryDraft[]): CanonDraft {
  return { countries, disputes: [], presets: [], warnings: [] };
}

describe('diffCanon', () => {
  it('reports added, removed and changed slugs', () => {
    const prev = [
      { slug: 'fr', fingerprint: fingerprintCountry(country({})) },
      { slug: 'xx', fingerprint: 'stale' },
    ];
    const d = draft([country({}), country({ slug: 'de', name: 'Germany', iso2: 'DE', iso3: 'DEU' })]);
    expect(diffCanon(prev, d)).toEqual({ added: ['de'], removed: ['xx'], changed: [] });
  });

  it('detects field changes via fingerprint', () => {
    const prev = [{ slug: 'fr', fingerprint: fingerprintCountry(country({})) }];
    const d = draft([country({ class: 'territory' })]);
    expect(diffCanon(prev, d).changed).toEqual(['fr']);
  });
});

describe('loadCanon', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    // Default: every query returns a row with an id (covers all RETURNING id upserts)
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    // First call is fetchPrevState's SELECT — empty previous canon
    mockedQuery.mockResolvedValueOnce({ rows: [] });
  });

  it('upserts countries by slug and refreshes the canon map', async () => {
    await loadCanon(draft([country({})]), new Map(), new Map(), { wikidata: 'now' });
    const sqls = mockedQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO countries/.test(s) && /ON CONFLICT \(slug\)/.test(s))).toBe(true);
    expect(sqls.some((s) => /REFRESH MATERIALIZED VIEW division_canon_map/.test(s))).toBe(true);
  });

  it('replaces coverage and dispute members instead of appending', async () => {
    await loadCanon(draft([country({})]), new Map([[1, 'fr']]), new Map(), {});
    const sqls = mockedQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /DELETE FROM country_divisions/.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM disputed_territory_members/.test(s))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/canonSync/loader.test.ts`
Expected: FAIL — cannot resolve `./loader.js`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Loads a derived CanonDraft into the DB. Slug is the stable identity:
 * countries upsert by slug (ids survive rebuilds, so user prefs survive);
 * coverage/claims/members/presets are replaced wholesale (they are pure
 * derivations). Never touches user_disputed_preferences.
 */
import { pool } from '../../db/index.js';
import type { CanonDraft, CanonSyncReport, CountryDraft } from './types.js';

export function fingerprintCountry(c: CountryDraft): string {
  return JSON.stringify([c.name, c.class, c.iso2, c.iso3, c.m49, c.sovereignSlug, c.wikidataQid]);
}

export function diffCanon(
  prev: { slug: string; fingerprint: string }[],
  draft: CanonDraft,
): { added: string[]; removed: string[]; changed: string[] } {
  const prevMap = new Map(prev.map((p) => [p.slug, p.fingerprint]));
  const nextMap = new Map(draft.countries.map((c) => [c.slug, fingerprintCountry(c)]));
  const added = [...nextMap.keys()].filter((s) => !prevMap.has(s)).sort();
  const removed = [...prevMap.keys()].filter((s) => !nextMap.has(s)).sort();
  const changed = [...nextMap.entries()]
    .filter(([slug, fp]) => prevMap.has(slug) && prevMap.get(slug) !== fp)
    .map(([slug]) => slug).sort();
  return { added, removed, changed };
}

async function fetchPrevState(): Promise<{ slug: string; fingerprint: string }[]> {
  const res = await pool.query(`
    SELECT c.slug, c.name, c.class, c.iso_alpha2, c.iso_alpha3, c.m49_code,
           s.slug AS sovereign_slug, c.wikidata_qid
    FROM countries c LEFT JOIN countries s ON s.id = c.sovereign_id`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    slug: r.slug as string,
    fingerprint: JSON.stringify([r.name, r.class, r.iso_alpha2, r.iso_alpha3,
      r.m49_code === null ? null : Number(r.m49_code), r.sovereign_slug ?? null, r.wikidata_qid ?? null]),
  }));
}

async function upsertCountries(draft: CanonDraft): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const c of draft.countries) {
    const res = await pool.query(`
      INSERT INTO countries (slug, name, class, iso_alpha2, iso_alpha3, m49_code, wikidata_qid, sources, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, class = EXCLUDED.class, iso_alpha2 = EXCLUDED.iso_alpha2,
        iso_alpha3 = EXCLUDED.iso_alpha3, m49_code = EXCLUDED.m49_code,
        wikidata_qid = EXCLUDED.wikidata_qid, sources = EXCLUDED.sources, updated_at = NOW()
      RETURNING id`,
      [c.slug, c.name, c.class, c.iso2, c.iso3, c.m49, c.wikidataQid, JSON.stringify(c.provenance)]);
    ids.set(c.slug, (res.rows[0] as { id: number }).id);
  }
  // Sovereign links in a second pass (all ids known)
  for (const c of draft.countries) {
    await pool.query('UPDATE countries SET sovereign_id = $1 WHERE slug = $2',
      [c.sovereignSlug ? ids.get(c.sovereignSlug) ?? null : null, c.slug]);
  }
  // Entries no longer produced by the rules are removed (prefs cascade only
  // via dispute rows; country removal of a slug with history shows in diff)
  await pool.query('DELETE FROM countries WHERE NOT (slug = ANY($1))',
    [draft.countries.map((c) => c.slug)]);
  return ids;
}

async function replaceCoverage(crosswalk: Map<number, string>, ids: Map<string, number>): Promise<void> {
  await pool.query('DELETE FROM country_divisions');
  for (const [divisionId, slug] of crosswalk) {
    const countryId = ids.get(slug);
    if (countryId === undefined) continue;
    await pool.query(
      'INSERT INTO country_divisions (country_id, division_id) VALUES ($1, $2) ON CONFLICT (division_id) DO NOTHING',
      [countryId, divisionId]);
  }
}

async function replaceDisputes(
  draft: CanonDraft, ids: Map<string, number>,
  disputeUnits: Map<string, { divisionIds: number[]; approximate: boolean }>,
): Promise<{ slug: string; unitCount: number; approximate: boolean }[]> {
  const summary: { slug: string; unitCount: number; approximate: boolean }[] = [];
  await pool.query('DELETE FROM disputed_territory_members');
  await pool.query('DELETE FROM disputed_territory_claims');
  await pool.query('DELETE FROM disputed_territories WHERE NOT (slug = ANY($1))',
    [draft.disputes.map((d) => d.slug)]);
  for (const d of draft.disputes) {
    const units = disputeUnits.get(d.slug) ?? { divisionIds: [], approximate: true };
    const res = await pool.query(`
      INSERT INTO disputed_territories (slug, name, kind, subject_country_id, is_approximate, wikidata_qid, sources)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, kind = EXCLUDED.kind, subject_country_id = EXCLUDED.subject_country_id,
        is_approximate = EXCLUDED.is_approximate, wikidata_qid = EXCLUDED.wikidata_qid, sources = EXCLUDED.sources
      RETURNING id`,
      [d.slug, d.name, d.kind, d.subjectCountrySlug ? ids.get(d.subjectCountrySlug) ?? null : null,
        units.approximate, d.wikidataQid, JSON.stringify(d.provenance)]);
    const disputeId = (res.rows[0] as { id: number }).id;
    for (const claim of d.claims) {
      const countryId = ids.get(claim.countrySlug);
      if (countryId === undefined) continue;
      await pool.query(`
        INSERT INTO disputed_territory_claims (dispute_id, country_id, role, note) VALUES ($1, $2, $3, $4)
        ON CONFLICT (dispute_id, country_id) DO UPDATE SET role = EXCLUDED.role, note = EXCLUDED.note`,
        [disputeId, countryId, claim.role, claim.note]);
    }
    for (const divisionId of units.divisionIds) {
      await pool.query(
        'INSERT INTO disputed_territory_members (dispute_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [disputeId, divisionId]);
    }
    summary.push({ slug: d.slug, unitCount: units.divisionIds.length, approximate: units.approximate });
  }
  return summary;
}

async function replacePresets(draft: CanonDraft, ids: Map<string, number>): Promise<void> {
  await pool.query('DELETE FROM disputed_preset_choices');
  for (const p of draft.presets) {
    const res = await pool.query(`
      INSERT INTO disputed_presets (slug, name, is_default) VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_default = EXCLUDED.is_default
      RETURNING id`, [p.slug, p.name, p.isDefault]);
    const presetId = (res.rows[0] as { id: number }).id;
    for (const choice of p.choices) {
      const disputeRes = await pool.query('SELECT id FROM disputed_territories WHERE slug = $1', [choice.disputeSlug]);
      if (disputeRes.rows.length === 0) continue;
      await pool.query(`
        INSERT INTO disputed_preset_choices (preset_id, dispute_id, counts_as, country_id, sources)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (preset_id, dispute_id) DO UPDATE SET
          counts_as = EXCLUDED.counts_as, country_id = EXCLUDED.country_id, sources = EXCLUDED.sources`,
        [presetId, (disputeRes.rows[0] as { id: number }).id, choice.countsAs,
          choice.countrySlug ? ids.get(choice.countrySlug) ?? null : null,
          JSON.stringify([choice.provenance])]);
    }
  }
}

export async function loadCanon(
  draft: CanonDraft,
  crosswalk: Map<number, string>,
  disputeUnits: Map<string, { divisionIds: number[]; approximate: boolean }>,
  sourceVersions: Record<string, string>,
  unmatchedRootUnits: { id: number; name: string }[] = [],
): Promise<CanonSyncReport> {
  const prev = await fetchPrevState();
  const ids = await upsertCountries(draft);
  await replaceCoverage(crosswalk, ids);
  const disputes = await replaceDisputes(draft, ids, disputeUnits);
  await replacePresets(draft, ids);
  await pool.query('REFRESH MATERIALIZED VIEW division_canon_map');
  const { added, removed, changed } = diffCanon(prev, draft);
  return {
    countriesTotal: draft.countries.length,
    added, removed, changed,
    unmatchedRootUnits,
    disputes,
    warnings: draft.warnings,
    sourceVersions,
  };
}

export async function createCanonSyncLog(triggeredBy: number | null): Promise<number> {
  const res = await pool.query(
    'INSERT INTO canon_sync_logs (status, triggered_by) VALUES ($1, $2) RETURNING id',
    ['running', triggeredBy]);
  return (res.rows[0] as { id: number }).id;
}

export async function finishCanonSyncLog(
  logId: number, status: 'success' | 'partial' | 'failed' | 'cancelled',
  report: CanonSyncReport | null,
): Promise<void> {
  await pool.query(
    `UPDATE canon_sync_logs SET status = $1, report = $2, source_versions = $3, completed_at = NOW() WHERE id = $4`,
    [status, report ? JSON.stringify(report) : null,
      report ? JSON.stringify(report.sourceVersions) : null, logId]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/canonSync/loader.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Checkpoint (no-commit mode)** — proposed message: `back: add canon loader (slug upserts, coverage/dispute replacement, diff report)`.

---

### Task 8: Orchestration, controller, routes

**Files:**
- Create: `backend/src/services/canonSync/index.ts`
- Test: `backend/src/services/canonSync/index.test.ts`
- Create: `backend/src/controllers/admin/canonSyncController.ts`
- Modify: `backend/src/routes/adminRoutes.ts` (add imports + 3 routes next to the `/wv-extract/*` block at `:226-238`)

**Interfaces:**
- Consumes: everything from Tasks 3–7.
- Produces: `syncCanon(triggeredBy: number | null): boolean` (false = already running), `getCanonSyncStatus(): CanonSyncProgress | null`, `cancelCanonSync(): boolean`, plus `getLastCanonLog(): Promise<{ id, status, report, sourceVersions, startedAt, completedAt } | null>`. Routes: `POST /api/admin/canon/sync`, `GET /api/admin/canon/sync`, `DELETE /api/admin/canon/sync` (admin auth comes from the `/api/admin` mount in `routes/index.ts:37`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }), connect: vi.fn() } }));
vi.mock('./wikidataSource.js', () => ({ fetchWikidataCountries: vi.fn().mockResolvedValue([]) }));
vi.mock('./naturalEarthSource.js', () => ({
  fetchNeCountries: vi.fn().mockResolvedValue([]),
  fetchNeDisputed: vi.fn().mockResolvedValue([]),
  NE_SOURCE_VERSION: 'test',
}));
vi.mock('./unitMatching.js', () => ({
  matchRootUnits: vi.fn().mockResolvedValue({ crosswalk: new Map(), unmatched: [] }),
  landDisputeUnits: vi.fn().mockResolvedValue({ divisionIds: [], approximate: false }),
}));
vi.mock('./loader.js', () => ({
  loadCanon: vi.fn().mockResolvedValue({
    countriesTotal: 0, added: [], removed: [], changed: [],
    unmatchedRootUnits: [], disputes: [], warnings: [], sourceVersions: {},
  }),
  createCanonSyncLog: vi.fn().mockResolvedValue(7),
  finishCanonSyncLog: vi.fn().mockResolvedValue(undefined),
}));

import { syncCanon, getCanonSyncStatus, cancelCanonSync, _resetForTests } from './index.js';

describe('canon sync orchestration', () => {
  beforeEach(() => _resetForTests());

  it('starts a sync and refuses a second concurrent start', async () => {
    expect(syncCanon(1)).toBe(true);
    expect(syncCanon(1)).toBe(false);
    await vi.waitFor(() => expect(getCanonSyncStatus()?.status).toBe('complete'));
  });

  it('reports progress and completes with a report', async () => {
    syncCanon(null);
    await vi.waitFor(() => expect(getCanonSyncStatus()?.status).toBe('complete'));
    expect(getCanonSyncStatus()?.report).not.toBeNull();
  });

  it('cancel flips the flag only while running', async () => {
    expect(cancelCanonSync()).toBe(false);
    syncCanon(null);
    // May already be complete (all mocks resolve instantly) — accept either
    const cancelled = cancelCanonSync();
    expect(typeof cancelled).toBe('boolean');
    await vi.waitFor(() => {
      const s = getCanonSyncStatus()?.status;
      expect(s === 'complete' || s === 'cancelled').toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/canonSync/index.test.ts`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Implement `index.ts`**

```typescript
/**
 * Country canon sync — orchestration. Module-level current-run state,
 * following the wv-extract pattern (start / status / cancel; the `finally`
 * uses the captured progress reference to avoid timer races).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../db/index.js';
import { fetchWikidataCountries } from './wikidataSource.js';
import { fetchNeCountries, fetchNeDisputed, NE_SOURCE_VERSION } from './naturalEarthSource.js';
import { deriveCanon } from './rules.js';
import { matchRootUnits, landDisputeUnits } from './unitMatching.js';
import { loadCanon, createCanonSyncLog, finishCanonSyncLog } from './loader.js';
import type { CanonException, CanonSyncProgress, UnitMatchOverride } from './types.js';

const LOG_PREFIX = '[Canon Sync]';
const configDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config');

let current: CanonSyncProgress | null = null;

function readConfig<T>(file: string, key: string): T {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from module dir + literal file names below
  const raw = fs.readFileSync(path.join(configDir, file), 'utf-8');
  return (JSON.parse(raw) as Record<string, T>)[key];
}

function isRunning(p: CanonSyncProgress | null): boolean {
  return !!p && p.status !== 'complete' && p.status !== 'failed' && p.status !== 'cancelled';
}

function checkCancel(progress: CanonSyncProgress): void {
  if (progress.cancel) throw new Error('Canon sync cancelled');
}

async function runSync(progress: CanonSyncProgress, triggeredBy: number | null): Promise<void> {
  try {
    progress.logId = await createCanonSyncLog(triggeredBy);

    progress.status = 'fetching';
    progress.statusMessage = 'Fetching Wikidata + Natural Earth...';
    const [wikidata, neCountries, neDisputed] = await Promise.all([
      fetchWikidataCountries(LOG_PREFIX), fetchNeCountries(), fetchNeDisputed(),
    ]);
    checkCancel(progress);

    progress.status = 'deriving';
    progress.statusMessage = `Deriving canon from ${wikidata.length} Wikidata rows, ${neDisputed.length} NE disputed features...`;
    const exceptions = readConfig<CanonException[]>('exceptions.json', 'exceptions');
    // neCountries is NOT passed to deriveCanon (rules are geometry-free);
    // it feeds matchRootUnits below.
    const draft = deriveCanon({ wikidata, neDisputed, exceptions });
    checkCancel(progress);

    progress.status = 'matching';
    progress.statusMessage = `Matching ${draft.countries.length} countries to country-level units...`;
    const overrides = readConfig<UnitMatchOverride[]>('unit-match-overrides.json', 'overrides');
    const { crosswalk, unmatched } = await matchRootUnits(
      neCountries, draft.countries.map((c) => ({ slug: c.slug, iso3: c.iso3 })), overrides);
    const disputeUnits = new Map<string, { divisionIds: number[]; approximate: boolean }>();
    for (const d of draft.disputes) {
      checkCancel(progress);
      progress.statusMessage = `Landing dispute: ${d.name}`;
      disputeUnits.set(d.slug, await landDisputeUnits(d.neFeature));
    }

    progress.status = 'loading';
    progress.statusMessage = 'Loading canon into DB...';
    const report = await loadCanon(draft, crosswalk, disputeUnits, {
      wikidata: `query.wikidata.org @ ${progress.startedAt} (rules v1)`,
      naturalEarth: NE_SOURCE_VERSION,
    }, unmatched);

    progress.report = report;
    progress.status = 'complete';
    progress.statusMessage =
      `Complete: ${report.countriesTotal} countries (+${report.added.length}/-${report.removed.length}/~${report.changed.length}), `
      + `${report.disputes.length} disputes, ${report.unmatchedRootUnits.length} unmatched root units`;
    await finishCanonSyncLog(progress.logId, 'success', report);
    console.log(`${LOG_PREFIX} ${progress.statusMessage}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = msg;
    if (progress.logId !== null) {
      await finishCanonSyncLog(progress.logId, progress.status === 'cancelled' ? 'cancelled' : 'failed', progress.report)
        .catch((e) => console.error(`${LOG_PREFIX} failed to finalize log:`, e));
    }
    console.error(`${LOG_PREFIX} ${progress.status}:`, msg);
  }
}

/** Start a canon sync. Returns false if one is already running. */
export function syncCanon(triggeredBy: number | null): boolean {
  if (isRunning(current)) return false;
  const progress: CanonSyncProgress = {
    cancel: false, status: 'fetching', statusMessage: 'Starting...',
    startedAt: new Date().toISOString(), logId: null, report: null,
  };
  current = progress;
  void runSync(progress, triggeredBy);
  return true;
}

export function getCanonSyncStatus(): CanonSyncProgress | null {
  return current;
}

export function cancelCanonSync(): boolean {
  if (!isRunning(current)) return false;
  if (current) { current.cancel = true; current.statusMessage = 'Cancelling...'; }
  return true;
}

export async function getLastCanonLog(): Promise<Record<string, unknown> | null> {
  const res = await pool.query(`
    SELECT id, status, report, source_versions AS "sourceVersions",
           started_at AS "startedAt", completed_at AS "completedAt"
    FROM canon_sync_logs ORDER BY id DESC LIMIT 1`);
  return (res.rows[0] as Record<string, unknown>) ?? null;
}

/** Test hook: clear module state between tests. */
export function _resetForTests(): void {
  current = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/canonSync/index.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Controller**

Create `backend/src/controllers/admin/canonSyncController.ts`:

```typescript
/**
 * Admin Country Canon Sync Controller
 * POST /api/admin/canon/sync    — start a rebuild from open sources
 * GET  /api/admin/canon/sync    — progress + last build log (report/diff)
 * DELETE /api/admin/canon/sync  — cancel the running rebuild
 */
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { syncCanon, getCanonSyncStatus, cancelCanonSync, getLastCanonLog } from '../../services/canonSync/index.js';

export function startCanonSync(req: AuthenticatedRequest, res: Response): void {
  const started = syncCanon(req.user?.id ?? null);
  if (!started) {
    res.status(409).json({ error: 'A canon sync is already running' });
    return;
  }
  res.json({ started: true });
}

export async function getCanonSyncState(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const progress = getCanonSyncStatus();
  const lastLog = await getLastCanonLog();
  res.json({ progress, lastLog });
}

export function cancelCanonSyncEndpoint(_req: AuthenticatedRequest, res: Response): void {
  const cancelled = cancelCanonSync();
  res.json({ cancelled });
}
```

- [ ] **Step 6: Wire routes**

In `backend/src/routes/adminRoutes.ts`: add the import next to the wikivoyage controller import block (`:129-133` area):

```typescript
import {
  startCanonSync,
  getCanonSyncState,
  cancelCanonSyncEndpoint,
} from '../controllers/admin/canonSyncController.js';
```

and add routes right after the `/wv-extract/*` block (after `:238`):

```typescript
// Country canon: rebuild from open sources (spec: country-canon-and-disputes.md)
router.post('/canon/sync', startCanonSync);
router.get('/canon/sync', getCanonSyncState);
router.delete('/canon/sync', cancelCanonSyncEndpoint);
```

- [ ] **Step 7: Typecheck + full backend suite**

Run: `cd backend && npx tsc --noEmit && npx vitest run src/services/canonSync/`
Expected: PASS (all canonSync tests green, no type errors).

- [ ] **Step 8: Checkpoint (no-commit mode)** — proposed message: `back: add canon sync orchestration + admin endpoints`.

---

### Task 9: Real run + calibration (the sync meets reality)

> **Erratum 2026-07-18 (first real run, findings A-E + S1; fixes adjudicated):**
> (A) coverage query 42803 — aggregate via subquery `(SELECT ST_Union(geom) …) u`;
> (B) limited-recognition QID Q15634554 was merged into **Q10711424** — query
> must use the live QID; (C) NE features sharing one country key must MERGE
> geometry (`ON CONFLICT DO UPDATE … ST_Collect`) not drop; (D) NE `SOV_A3`
> group codes (GB1/IS1/KA1…) resolve via a sovereignty map built from the
> countries layer (feature with same SOV_A3 and Sovereign type → its iso3),
> applied before derive/matching; (E) claims of dispute-feature entities come
> from a dedicated `fetchDisputeClaims(qids)` VALUES query (membership query
> never returns non-member entities), passed into `deriveCanon` as
> `disputeClaims`; (S1) membership query gains `FILTER NOT EXISTS { ?item
> wdt:P576 [] }` (dissolved states) — expect un_member ≈193 again. Canary
> redefined: division 105332 is Kerguelen (→ `tf` correct); the Antarctic-claim
> canary is division 3218 → `aq`.

No new files — this task runs the real sync against the dev DB and calibrates `unit-match-overrides.json` / `exceptions.json` until the report is clean. **This is where Task 3 Step 5 / Task 4 Step 1 surprises get fixed.**

- [ ] **Step 1: Start the stack and trigger the sync**

Run: `npm run dev` (or ensure backend + DB are up), then:
```bash
curl -s -X POST http://localhost:3001/api/admin/canon/sync -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
watch -n 3 "curl -s http://localhost:3001/api/admin/canon/sync -H \"Authorization: Bearer \$ADMIN_TOKEN\" | jq '.progress | {status, statusMessage}'"
```
Expected: `fetching → deriving → matching → loading → complete` (first run: minutes — Wikidata + two NE files + ~260 geometric matches; subsequent runs hit the FileCache).

- [ ] **Step 2: Inspect the report**

```bash
curl -s http://localhost:3001/api/admin/canon/sync -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.lastLog.report | {countriesTotal, added: (.added|length), unmatchedRootUnits, disputes, warnings}'
```
Acceptance targets:
- `countriesTotal` in **250–280**;
- `unmatchedRootUnits` — work the list down to **0** by adding entries to `unit-match-overrides.json` (name mismatches) — re-run sync after each config change;
- `disputes` — non-empty (expect ≈ 9 existence + several attribution per spec); each `approximate` flag eyeballed against reality (Crimea should be exact: 2 units; South Ossetia approximate is OK);
- `warnings` — resolve duplicates (expected: Western Sahara/SADR pair) via `exceptions.json` `mergeInto`/`setClass` with justification + source, per spec.

- [ ] **Step 3: Sanity SQL**

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions -c "
SELECT class, COUNT(*) FROM countries GROUP BY class ORDER BY class;
SELECT COUNT(*) AS roots_covered FROM country_divisions;
SELECT COUNT(*) AS map_rows, COUNT(DISTINCT base_country_id) AS countries_mapped FROM division_canon_map;
SELECT d.slug, d.kind, d.is_approximate, COUNT(m.id) AS units
FROM disputed_territories d LEFT JOIN disputed_territory_members m ON m.dispute_id = d.id
GROUP BY d.id ORDER BY d.slug;"
```
Expected: class counts ≈ {un_member: 193, un_observer: 2, de_facto: 6–10, territory: 40–60, special: 1–3}; `roots_covered` == country-level unit count = **237** (`SELECT COUNT(*) FROM administrative_divisions ad JOIN administrative_divisions r ON ad.parent_id = r.id WHERE r.parent_id IS NULL`); `map_rows` == total divisions minus the 8 continent roots (**392104**); every dispute has units ≥ 1. **Canary:** the Antarctic claim slices named after countries must map to `aq`, not the claimant — check `SELECT c.slug FROM division_canon_map m JOIN countries c ON c.id = m.base_country_id WHERE m.division_id = 105332` (the "France" unit under Antarctica) returns `aq`.

- [ ] **Step 4: Idempotency check**

Trigger the sync again; expected: report diff shows `added: [], removed: [], changed: []` (stable slugs, no churn).

- [ ] **Step 5: Checkpoint (no-commit mode)** — config files now carry real overrides/exceptions; proposed message: `back: calibrate canon matching (overrides + justified exceptions)`.

---

### Task 10: Docs, ADR, gates

**Files:**
- Create: `docs/tech/country-canon.md`
- Create: `docs/decisions/0018-country-canon-user-decides.md`
- Modify: `docs/tech/planning/country-canon-and-disputes.md` (mark slice 1 done in «Фазировка»)

- [ ] **Step 1: Write `docs/tech/country-canon.md`**

```markdown
# Country Canon — Data Layer

Global registry of countries + disputed territories, **derived dynamically
from open sources by published rules** — never hand-authored. Design &
rationale: [planning/country-canon-and-disputes.md](planning/country-canon-and-disputes.md).

## Tables

- `countries` — superset registry (~260): class `un_member | un_observer |
  de_facto | territory | special`, ISO codes, sovereign link, `sources`
  (provenance per record). Stable identity = `slug`.
- `country_divisions` — base coverage: country-level unit of the current unit
  source → country (country level = children of the tree roots; the roots are
  continents in the current import). Rebuilt every sync.
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
  warnings), source versions.

## The sync (how the list is built)

`backend/src/services/canonSync/` — admin-triggered service
(`syncCanon` / `getCanonSyncStatus` / `cancelCanonSync`):

1. **Fetch** (cached in `data/cache/canon/`): Wikidata SPARQL (ISO codes,
   UN membership, limited recognition, P17 sovereign, P1336 claimed-by),
   Natural Earth admin-0 + disputed/breakaway GeoJSON.
2. **Derive** (`rules.ts` — the published rules): membership = ISO ∪ UN ∪
   limited-recognition; classes by rule; disputes from NE features; presets
   from source attributes. Manual input = `config/unit-match-overrides.json`
   (unit matching only) + `config/exceptions.json` (justified deviations).
3. **Match geometrically** (`unitMatching.ts`): country-level units ↔ NE
   country polygons by max overlap; dispute polygons land on units (whole
   country unit or its children; partial → `is_approximate`). No unit-source
   codes involved — swapping GADM for another unit source only rebuilds this
   step.
4. **Load** (`loader.ts`): upsert by slug (user prefs survive rebuilds),
   replace derived links wholesale, refresh `division_canon_map`, log report
   with diff vs the previous build.

API: `POST/GET/DELETE /api/admin/canon/sync` (admin-only).

Run locally: trigger via the API (see plan Task 9) or wait for the admin UI
(slice 3).
```

- [ ] **Step 2: Write ADR 0018**

`docs/decisions/0018-country-canon-user-decides.md` (follow `docs/decisions/adr-template.md` structure):

```markdown
# ADR-0018: Country canon as a derived global registry; disputes resolved by the user

## Status

Accepted (2026-07-18)

## Context

World-view work needs a stable country level (L2). Two questions had to be
settled: (1) where does the list of countries come from, and (2) how are
disputed territories handled. The 2026-06-28 strategic review recommended
against building a platform-curated perspectives engine (perspectives ×
rulings × resolver) in v1, and for the early "the platform never chooses —
the user decides" model. Nikolay added two hard constraints (2026-07-17/18):
the list must be a **derivative of open standards by published rules**
(explainable to users, not our editorial product), built **dynamically**
(not a committed artifact), and **not coupled to GADM** (the current unit
source is an implementation detail).

## Decision

- A global `countries` registry (superset with classes) + `disputed_territories`
  registry, derived by a sync service from open sources: Wikidata (CC0),
  Natural Earth (public domain), UN membership. Rules live in code
  (`canonSync/rules.ts`); manual input is limited to unit-match overrides and
  justified exceptions, both in git.
- Disputes affect **per-user counting only** (`user_disputed_preferences`,
  presets as pre-filled choices; `de_facto` default). No perspectives engine;
  preset data is forward-compatible as its future seed.
- Canon references only internal `administrative_divisions.id`; coverage and
  dispute unit sets are landed geometrically, so the unit source (GADM today,
  per ADR-0002) can be swapped by rebuilding the crosswalk only.

## Consequences

- The country list is explainable ("derived from ISO/UN/Wikidata/NE by these
  rules, on this date") and politically neutral by construction.
- Source drift (esp. Wikidata) surfaces as build diffs, guarded by exceptions.
- Supersedes nothing; extends ADR-0002 (GADM stays geometry/skeleton source)
  and ADR-0005 (source-agnostic import) toward the layered model of
  world-view-levels-and-perspectives.md.
```

- [ ] **Step 3: Mark slice 1 done in the spec's «Фазировка» section**

In `docs/tech/planning/country-canon-and-disputes.md`, change the slice-1 line to start with `1. ✅ **Данные** …` (keep the rest of the line).

- [ ] **Step 4: Run the full gates**

Run (repo root): `npm run check`
Expected: PASS — knip must see all new files reachable (routes import the controller, controller imports the service). If knip flags `config/*.json`, add them to the service's imports check or knip ignore with a comment.

Run: `TEST_REPORT_LOCAL=1 npm test`
Expected: PASS including all new canonSync tests.

Run `/security-check` on the changed files.
Expected: clean — new admin endpoints are behind the `/api/admin` `requireAuth+requireAdmin` mount; external fetches go to fixed hosts (Wikidata, GitHub raw) with no user input in URLs; config reads use literal-derived paths.

- [ ] **Step 5: Final Checkpoint (no-commit mode)**

Show the full `git status` + diff stat. Proposed commit sequence for when Nikolay OKs committing (granular, per the development guide):
1. `back: add country canon schema (registry, disputes, presets, prefs, canon map)`
2. `back: add canonSync sources (Wikidata membership query, Natural Earth layers)`
3. `back: add canon derivation rules (membership, classes, disputes, presets)`
4. `back: add geometric unit matching + canon loader`
5. `back: add canon sync orchestration + admin endpoints`
6. `back: calibrate canon matching (overrides + justified exceptions)`
7. `docs: add country-canon tech doc + ADR-0018`

---

## Self-Review (by plan author)

- **Spec coverage (slice 1):** schema — Task 1 (all 9 tables + matview, names match the spec's DDL sketch, incl. the `canon_sync_logs` rename noted in Global Constraints); dynamic fetch + cache — Tasks 3–4; published rules incl. presets + exceptions — Task 5; geometric crosswalk + dispute landing + unit-source independence — Task 6; slug-stable upserts + diff report + log — Task 7; sync-service pattern + admin API per spec's API table — Task 8; calibration of thresholds/overrides (spec's open questions) — Task 9; ADR + tech doc per spec's «Документация при реализации» — Task 10. Slices 2–6 (read API, experience linkage, admin UI, prefs UI, map, /countries) are separate plans by design.
- **Placeholder scan:** none — every step has concrete code/commands. Tasks 3.5/4.1 are explicit *verification* steps against live sources (QID counts, NE file names/fields) with stated expected outcomes and adjustment instructions, not deferred work.
- **Type consistency:** `CanonDraft`/`CountryDraft`/`DisputeDraft`/`PresetDraft`/`CanonSyncProgress`/`CanonSyncReport` defined once in Task 2 and consumed unchanged in Tasks 3–8; `matchRootUnits`/`landDisputeUnits`/`loadCanon`/`createCanonSyncLog`/`finishCanonSyncLog` signatures match between definition (6–7) and orchestration (8); route handler names match the controller exports.
- **Known risks captured in-plan:** Wikidata query over-matching (3.5 fallback), NE layer naming drift (4.1), SADR/Western Sahara duplicate (9.2 via exceptions), unmatched roots like Caspian Sea (9.2 via overrides or left unmatched → report), matview inner-join semantics documented in the DDL comment.
