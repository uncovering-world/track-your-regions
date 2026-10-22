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
 * - per live kind, the expected things it lacks, the well-known ones by name, each
 *   with the judgement a person recorded on its gap in the committed ledger, where
 *   there is one (ADR-0116), and the judgements whose gap has since closed;
 * - per region, the other direction (#1601): what it offers that no guide names,
 *   least known first, each with its row judgement, and the rows a person judged
 *   not worth a visit that a kind still offers.
 */

import { ROW_CAUSES, type Cause } from '../../../services/catalogueCoverage/files.js';
import { ICONIC_SITELINKS } from '../../../services/sync/museum/tier1.js';
import { ENTER_SITELINKS } from '../../../services/sync/publicArt/pipeline.js';
import { TOWER_LINE } from '../../../services/sync/towers/kind.js';
import {
  readCoverageFacts,
  type CoverageFacts, type ExpectationRow, type JudgementRow, type KindRow, type MatchRow, type NearbyRow,
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

/** What a person judged about a gap, from the committed ledger (ADR-0116). */
export interface Judgement {
  cause: Cause;
  issue: number | null;
  judged: string;
  note: string;
}

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

/** One absent entry of a live kind, with the ledger's line on that gap where a person has judged it. */
export type MissingEntry = Pick<ExpectationResult, 'regionSlug' | 'slug' | 'name' | 'sitelinks' | 'sourceCount' | 'verdict'> & {
  judgement: Judgement | null;
};

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
  /** Its members exist only inside a place, so building it is building what a place holds. */
  inVenue: boolean;
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
  /** Absent from this kind and at or over its line (every absent one, where there is no line), by name, judged or not. */
  wellKnownMissing: MissingEntry[];
  /** Of `wellKnownMissing`, how many a person has judged under each cause, and the issues those judgements name. */
  judgedByCause: JudgedCause[];
  /** Absent from this kind and under its line: the regional tier's to hold. */
  belowLineMissing: number;
}

export interface JudgedCause {
  cause: Cause;
  count: number;
  issues: number[];
}

/** One cause's share of the judged, with the issues the judgements name: `90 door-missing (#628)`. */
export function causeWords(judged: JudgedCause): string {
  const issues = judged.issues.map(issue => `#${issue}`).join(', ');
  const owners = judged.issues.length > 0 ? ` (${issues})` : '';
  return `${judged.count} ${judged.cause}${owners}`;
}

/** A judgement on a gap its kind no longer has: the kind offers the entry, and the line is to be removed. */
export interface StaleJudgement extends Judgement {
  regionSlug: string;
  slug: string;
  name: string;
  kindSlug: string;
  kindName: string;
}

/** One offered place a surveyed region's guides do not name (#1601), with the ledger's line on it where a person has judged it. */
export interface UnnamedPlace {
  experienceId: number;
  name: string;
  /** Null for a place only its source's id names, which the ledger cannot judge. */
  wikidataId: string | null;
  /** The kinds that offer it, as the register names them. */
  kinds: string[];
  sitelinks: number | null;
  km: number;
  judgement: Judgement | null;
}

/** What one surveyed region offers that no guide names, and what a person has made of it. */
export interface RegionUnnamed {
  regionSlug: string;
  regionName: string;
  /** Every offered place within reach no entry names. */
  total: number;
  /** The ones nobody has judged, least known first: the order that finds the junk fastest. */
  unjudged: UnnamedPlace[];
  /** The ones nobody can judge: a place only its source's id names has no Wikidata id for the ledger to key on. */
  unjudgeable: UnnamedPlace[];
  /** Of the judged, how many under each cause. */
  judgedByCause: JudgedCause[];
  /** Judged not worth a visit, and a kind still offers it: a finding the kind's rule or a curator answers. */
  standing: UnnamedPlace[];
}

/** A judgement on a row no offered place within the region's reach carries now: the finding is answered, and the line is to be removed. */
export interface StaleRowJudgement extends Judgement {
  regionSlug: string;
  wikidataId: string;
}

export interface CoverageReport {
  regions: RegionCoverage[];
  proposedKinds: ProposedKindDemand[];
  liveKinds: LiveKindGaps[];
  expectations: ExpectationResult[];
  staleJudgements: StaleJudgement[];
  unnamed: RegionUnnamed[];
  staleRowJudgements: StaleRowJudgement[];
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

/**
 * The kinds whose line is in code: a monument enters on its own sitelinks, and
 * so does a work. A tower also asks a year's readers, which a survey entry does
 * not carry, so the report reads its editions alone.
 */
const CODE_LINES: Readonly<Record<string, number>> = {
  'public-art': ENTER_SITELINKS,
  'monuments-and-memorials': ENTER_SITELINKS,
  'notable-works': ICONIC_SITELINKS,
  towers: TOWER_LINE.enterEditions,
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

const toJudgement = (row: JudgementRow): Judgement =>
  ({ cause: row.cause as Cause, issue: row.issue_number, judged: row.judged, note: row.note });

/** A place judged not worth a visit: `not-a-must`, or a `rule-defect` the kind's rule should have refused. */
const notWorthAVisit = (judgement: Judgement | null): boolean =>
  judgement !== null && ROW_CAUSES.has(judgement.cause) && judgement.cause !== 'worth-a-visit';

/** Least known first: the fewest sitelinks, a place with no count last, then by name. */
const byObscurity = (a: UnnamedPlace, b: UnnamedPlace): number =>
  (a.sitelinks ?? Number.MAX_SAFE_INTEGER) - (b.sitelinks ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);

/**
 * What each region offers that no guide names (#1601), with the ledger's row judgements
 * joined by Wikidata id. A judged row no offered place within reach carries now is stale.
 */
function unnamedByRegion(
  facts: CoverageFacts, kindNames: Map<number, string>, regionNames: Map<string, string>,
): { unnamed: RegionUnnamed[]; stale: StaleRowJudgement[] } {
  const rowKey = (regionSlug: string, wikidataId: string) => `${regionSlug}\n${wikidataId}`;
  const onRows = facts.judgements.filter(row => row.row_wikidata_id !== null);
  const judgements = new Map(onRows.map(row => [rowKey(row.region_slug, row.row_wikidata_id as string), toJudgement(row)]));
  const carried = new Set<string>();
  const places = new Map<string, UnnamedPlace[]>();
  for (const row of facts.unnamed) {
    const judgement = row.wikidata_id === null ? null : judgements.get(rowKey(row.region_slug, row.wikidata_id)) ?? null;
    if (row.wikidata_id !== null) carried.add(rowKey(row.region_slug, row.wikidata_id));
    const place: UnnamedPlace = {
      experienceId: row.experience_id,
      name: row.name,
      wikidataId: row.wikidata_id,
      kinds: row.kind_ids.map(id => kindNames.get(id) ?? `kind ${id}`),
      sitelinks: row.sitelinks,
      km: row.km,
      judgement,
    };
    const list = places.get(row.region_slug);
    if (list) list.push(place);
    else places.set(row.region_slug, [place]);
  }
  const unnamed: RegionUnnamed[] = facts.regions.map((region) => {
    const own = places.get(region.slug) ?? [];
    return {
      regionSlug: region.slug,
      regionName: regionNames.get(region.slug) ?? region.slug,
      total: own.length,
      unjudged: own.filter(place => place.judgement === null && place.wikidataId !== null).sort(byObscurity),
      unjudgeable: own.filter(place => place.wikidataId === null).sort(byObscurity),
      judgedByCause: judgedByCause(own),
      standing: own.filter(place => notWorthAVisit(place.judgement)).sort(byObscurity),
    };
  });
  const stale: StaleRowJudgement[] = onRows
    .filter(row => !carried.has(rowKey(row.region_slug, row.row_wikidata_id as string)))
    .map(row => ({ ...toJudgement(row), regionSlug: row.region_slug, wikidataId: row.row_wikidata_id as string }));
  return { unnamed, stale };
}

/** How many of `missing` a person has judged under each cause, in the order of the causes' first appearance by renown. */
function judgedByCause(missing: Pick<MissingEntry, 'judgement'>[]): JudgedCause[] {
  const counted = new Map<Cause, JudgedCause>();
  for (const { judgement } of missing) {
    if (!judgement) continue;
    const entry = counted.get(judgement.cause) ?? { cause: judgement.cause, count: 0, issues: [] };
    entry.count += 1;
    if (judgement.issue !== null && !entry.issues.includes(judgement.issue)) entry.issues.push(judgement.issue);
    counted.set(judgement.cause, entry);
  }
  return [...counted.values()].map(entry => ({ ...entry, issues: [...entry.issues].sort((a, b) => a - b) }));
}

export function buildCoverageReport(facts: CoverageFacts): CoverageReport {
  const kinds = new Map(facts.kinds.map(kind => [kind.slug, kind]));
  const matches = group(facts.matches);
  const nearby = group(facts.nearby);
  // A judgement on a gap is found by the entry and the kind whose gap it is: an entry filed
  // under two live kinds has two gaps, judged apart. One on a catalogue row has no entry to join.
  const gapKey = (regionSlug: string, slug: string, kindSlug: string) => `${regionSlug}\n${slug}\n${kindSlug}`;
  const onEntries = facts.judgements.filter(row => row.entry_slug !== null && row.kind_slug !== null);
  const judgements = new Map(onEntries.map(row => [gapKey(row.region_slug, row.entry_slug as string, row.kind_slug as string), toJudgement(row)]));

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
  const names = new Map(expectations.map(result => [`${result.regionSlug}\n${result.slug}`, result.name]));

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
        inVenue: kind.in_venue,
        issue: kind.issue_number,
        expected: filed.length,
        regions: new Set(filed.map(result => result.regionSlug)).size,
        offeredElsewhere: filed.filter(result => result.verdict === 'offered').length,
        examples: [...filed].sort(byRenown).slice(0, EXAMPLES).map(result => result.name),
      };
    })
    .filter(demand => demand.expected > 0)
    .sort((a, b) => b.regions - a.regions || b.expected - a.expected || a.slug.localeCompare(b.slug));

  // A gap a live kind still has, over or under the line: a judgement on any other gap is stale.
  const stillLacked = new Set<string>();
  const liveKinds: LiveKindGaps[] = facts.kinds
    .filter(kind => kind.status === 'live')
    .map((kind) => {
      const filed = filedUnder(kind);
      const absent = filed.filter(result => !offeredIn(result, kind));
      for (const result of absent) stillLacked.add(gapKey(result.regionSlug, result.slug, kind.slug));
      const line = lineOf(kind);
      const wellKnown = absent.filter(result => line === null || (result.sitelinks ?? 0) >= line);
      const wellKnownMissing: MissingEntry[] = [...wellKnown].sort(byRenown)
        .map(({ regionSlug, slug, name, sitelinks, sourceCount, verdict }) => ({
          regionSlug, slug, name, sitelinks, sourceCount, verdict, judgement: judgements.get(gapKey(regionSlug, slug, kind.slug)) ?? null,
        }));
      return {
        slug: kind.slug,
        name: kind.name,
        line,
        expected: filed.length,
        offered: filed.length - absent.length,
        wellKnownMissing,
        judgedByCause: judgedByCause(wellKnownMissing),
        belowLineMissing: absent.length - wellKnown.length,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const staleJudgements: StaleJudgement[] = onEntries
    .filter(row => !stillLacked.has(gapKey(row.region_slug, row.entry_slug as string, row.kind_slug as string)))
    .map(row => ({
      ...toJudgement(row),
      regionSlug: row.region_slug,
      slug: row.entry_slug as string,
      name: names.get(`${row.region_slug}\n${row.entry_slug}`) ?? (row.entry_slug as string),
      kindSlug: row.kind_slug as string,
      kindName: kinds.get(row.kind_slug as string)?.name ?? (row.kind_slug as string),
    }));

  const kindNames = new Map(facts.kinds.filter(kind => kind.experience_kind_id !== null).map(kind => [kind.experience_kind_id as number, kind.name]));
  const { unnamed, stale: staleRowJudgements } = unnamedByRegion(facts, kindNames, new Map(regions.map(region => [region.slug, region.name])));

  return { regions, proposedKinds, liveKinds, expectations, staleJudgements, unnamed, staleRowJudgements };
}

/** The report over what is loaded now, for every region or for `regionSlugs`. */
export async function coverageReport(regionSlugs?: string[]): Promise<CoverageReport> {
  return buildCoverageReport(await readCoverageFacts(regionSlugs));
}
