/**
 * The coverage report: what the catalogue holds of what a traveller expects, and
 * which kind the expectations ask for most (ADR-0081).
 *
 * `buildCoverageReport` is pure: it takes the facts `readCoverageFacts` read and
 * decides. Three things come out of it:
 *
 * - per region, how many expectations stand in each verdict;
 * - per proposed kind, how much the surveys expect of it: the recommendation of
 *   what to build, which an issue cites and no code acts on;
 * - per live kind, the expected things it lacks, the well-known ones by name.
 */

import { ICONIC_SITELINKS } from '../../../services/sync/museum/tier1.js';
import { ENTER_SITELINKS } from '../../../services/sync/publicArt/pipeline.js';
import {
  readCoverageFacts,
  type CoverageFacts, type ExpectationRow, type KindRow, type MatchRow, type NearbyRow,
} from './reportQueries.js';

/**
 * Where one expectation stands, first match wins:
 *
 * - `offered`: the catalogue holds it under one of its identifiers and a reader sees it;
 * - `held`: it holds it and a reader does not: waiting for a curator, refused, lost;
 * - `unsorted`: absent, and filed under no kind yet;
 * - `missing_proposed`: absent, and every kind it is filed under is only proposed;
 * - `same_spot`: absent by identifier from a kind that exists, while an offered
 *   place stands at its spot. A person judges whether that is the same place under
 *   another item, a named point of a serial World Heritage row, or a neighbour; it
 *   is never counted as found;
 * - `missing_live`: absent, a kind it is filed under exists, and nothing stands
 *   at its spot.
 */
export const VERDICTS = ['offered', 'held', 'same_spot', 'missing_live', 'missing_proposed', 'unsorted'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One offered catalogue point at an expectation's spot. */
export type NearbyPoint = Pick<NearbyRow, 'place' | 'point' | 'metres'>;

export interface ExpectationResult {
  regionSlug: string;
  slug: string;
  name: string;
  type: string;
  kinds: string[];
  sourceCount: number;
  sitelinks: number | null;
  verdict: Verdict;
  /** The catalogue rows its identifiers match, offered or not. */
  matches: Pick<MatchRow, 'catalogue_name' | 'kind_id' | 'offered'>[];
  /** Offered catalogue points at its spot, nearest first; filled only for `same_spot`. */
  nearby: NearbyPoint[];
}

export interface RegionCoverage {
  slug: string;
  name: string;
  country: string;
  surveyed: string;
  total: number;
  counts: Record<Verdict, number>;
}

/** How much the surveys expect of a kind the product does not have. */
export interface ProposedKindDemand {
  slug: string;
  name: string;
  form: string;
  issue: number | null;
  /** Expectations filed under the kind, and the regions they come from. */
  expected: number;
  regions: number;
  /** Of them, those a reader already sees through another kind. */
  offeredElsewhere: number;
  /** The most named, most known ones. */
  examples: string[];
}

/** What a live kind lacks of what is expected of it. */
export interface LiveKindGaps {
  slug: string;
  name: string;
  /** The sitelinks a thing needs to be well known by this kind's own rule; null where the kind has no such line. */
  line: number | null;
  expected: number;
  offered: number;
  /** Absent from this kind and at or over its line (every absent one, where there is no line), by name. */
  wellKnownMissing: Pick<ExpectationResult, 'regionSlug' | 'name' | 'sitelinks' | 'sourceCount' | 'verdict'>[];
  /** Absent from this kind and under its line: the regional tier's to hold. */
  belowLineMissing: number;
}

export interface CoverageReport {
  regions: RegionCoverage[];
  proposedKinds: ProposedKindDemand[];
  liveKinds: LiveKindGaps[];
  expectations: ExpectationResult[];
}

const EXAMPLES = 5;

const key = (row: { region_slug: string; slug: string }): string => `${row.region_slug}\n${row.slug}`;

function group<T extends { region_slug: string; slug: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(key(row));
    if (list) list.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}

function verdictOf(entry: ExpectationRow, matches: MatchRow[], nearby: NearbyRow[], kinds: Map<string, KindRow>): Verdict {
  if (matches.some(match => match.offered)) return 'offered';
  if (matches.length > 0) return 'held';
  if (entry.kinds.length === 0) return 'unsorted';
  if (!entry.kinds.some(slug => kinds.get(slug)?.status === 'live')) return 'missing_proposed';
  // What stands at the spot is asked only of a place a live kind should hold:
  // there a neighbour may be the place itself under another item. A square
  // beside a fountain the catalogue holds is a neighbour and nothing else, a
  // work is at its venue by definition, and a route has no spot to stand on.
  return entry.type === 'place' && nearby.length > 0 ? 'same_spot' : 'missing_live';
}

/** The kinds whose line is in code: a monument enters on its own sitelinks, and so does a work. */
const CODE_LINES: Readonly<Record<string, number>> = {
  'public-art': ENTER_SITELINKS,
  'notable-works': ICONIC_SITELINKS,
};

/**
 * The line a live kind's own rule draws on a member's own sitelinks: its source's
 * `enterSitelinks` where it states one, else the code's. Two kinds have none.
 * World Heritage admits what is inscribed. Art Museums admits a museum through a
 * work it holds, so a museum's own sitelinks are not what that kind asks of it.
 */
function lineOf(kind: KindRow): number | null {
  return kind.enter_sitelinks ?? CODE_LINES[kind.slug] ?? null;
}

function offeredIn(result: ExpectationResult, kind: KindRow): boolean {
  // A work has no kind row of its own in the catalogue: offered anywhere is offered.
  if (kind.experience_kind_id === null) return result.matches.some(match => match.offered);
  return result.matches.some(match => match.offered && match.kind_id === kind.experience_kind_id);
}

/** A place two kinds admit is two catalogue rows at one point; the list names it once. */
function distinctPoints(near: NearbyRow[]): NearbyPoint[] {
  const seen = new Set<string>();
  const points: NearbyPoint[] = [];
  for (const { place, point, metres } of near) {
    const id = `${place}\n${point}\n${metres}`;
    if (seen.has(id)) continue;
    seen.add(id);
    points.push({ place, point, metres });
  }
  return points;
}

const byRenown = (a: ExpectationResult, b: ExpectationResult): number =>
  b.sourceCount - a.sourceCount || (b.sitelinks ?? -1) - (a.sitelinks ?? -1) || a.name.localeCompare(b.name);

export function buildCoverageReport(facts: CoverageFacts): CoverageReport {
  const kinds = new Map(facts.kinds.map(kind => [kind.slug, kind]));
  const matches = group(facts.matches);
  const nearby = group(facts.nearby);

  const expectations: ExpectationResult[] = facts.expectations.map((entry) => {
    const own = matches.get(key(entry)) ?? [];
    const near = nearby.get(key(entry)) ?? [];
    const verdict = verdictOf(entry, own, near, kinds);
    return {
      regionSlug: entry.region_slug,
      slug: entry.slug,
      name: entry.name,
      type: entry.type,
      kinds: entry.kinds,
      sourceCount: entry.source_count,
      sitelinks: entry.sitelinks,
      verdict,
      matches: own.map(({ catalogue_name, kind_id, offered }) => ({ catalogue_name, kind_id, offered })),
      nearby: verdict === 'same_spot' ? distinctPoints(near) : [],
    };
  });

  const regions: RegionCoverage[] = facts.regions.map((region) => {
    const own = expectations.filter(result => result.regionSlug === region.slug);
    const counts = Object.fromEntries(VERDICTS.map(verdict => [verdict, 0])) as Record<Verdict, number>;
    for (const result of own) counts[result.verdict] += 1;
    return { slug: region.slug, name: region.name, country: region.country, surveyed: region.surveyed, total: own.length, counts };
  });

  const filedUnder = (kind: KindRow) => expectations.filter(result => result.kinds.includes(kind.slug));

  const proposedKinds: ProposedKindDemand[] = facts.kinds
    .filter(kind => kind.status === 'proposed')
    .map((kind) => {
      const filed = filedUnder(kind);
      return {
        slug: kind.slug,
        name: kind.name,
        form: kind.form,
        issue: kind.issue_number,
        expected: filed.length,
        regions: new Set(filed.map(result => result.regionSlug)).size,
        offeredElsewhere: filed.filter(result => result.verdict === 'offered').length,
        examples: [...filed].sort(byRenown).slice(0, EXAMPLES).map(result => result.name),
      };
    })
    .filter(demand => demand.expected > 0)
    .sort((a, b) => b.regions - a.regions || b.expected - a.expected || a.slug.localeCompare(b.slug));

  const liveKinds: LiveKindGaps[] = facts.kinds
    .filter(kind => kind.status === 'live')
    .map((kind) => {
      const filed = filedUnder(kind);
      const absent = filed.filter(result => !offeredIn(result, kind));
      const line = lineOf(kind);
      const wellKnown = absent.filter(result => line === null || (result.sitelinks ?? 0) >= line);
      return {
        slug: kind.slug,
        name: kind.name,
        line,
        expected: filed.length,
        offered: filed.length - absent.length,
        wellKnownMissing: [...wellKnown].sort(byRenown)
          .map(({ regionSlug, name, sitelinks, sourceCount, verdict }) => ({ regionSlug, name, sitelinks, sourceCount, verdict })),
        belowLineMissing: absent.length - wellKnown.length,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { regions, proposedKinds, liveKinds, expectations };
}

/** The report over what is loaded now, for every region or for `regionSlugs`. */
export async function coverageReport(regionSlugs?: string[]): Promise<CoverageReport> {
  return buildCoverageReport(await readCoverageFacts(regionSlugs));
}
