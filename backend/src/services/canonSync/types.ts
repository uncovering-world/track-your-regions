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
  sovIso3: string | null;        // SOV_A3 — a composite group code (GB1, FR1, CH1...) for sovereignties
                                  // with dependencies; resolve via buildSovereignIso3Map, not directly
  homePart: boolean;             // NE HOMEPART=1: the home/mainland feature within its SOV_A3 group
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
