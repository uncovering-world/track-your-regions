/**
 * What the catalogue lacks of what a traveller expects (#1162, ADR-0081), and
 * what it offers that no traveller is sent to (#1601).
 *
 * The other checks ask whether the rows the catalogue holds mean what the
 * product says. These two ask over the survey lists in `db/catalogue-coverage/`
 * once they are loaded: which expected places and works a live kind does not
 * offer although its own rule calls them well known, and which offered places a
 * person has read as not worth a visit while a kind still offers them. A sync
 * that loses the Frida Kahlo Museum makes the first count grow, and nothing
 * else in the panel would see it; a stump of brick in the Forum a rule admits
 * is the second's business until the rule or a curator turns it away.
 *
 * The decision is the coverage report's (`catalogueCoverage/report.ts`), which
 * the terminal command prints too; this file only says its findings the way the
 * panel says a row. Nothing here decides what is offered, where a kind's line
 * is, or whether a judgement of the ledger (ADR-0116) still stands.
 */

import { causeWords, coverageReport, type CoverageReport, type Verdict } from '../catalogueCoverage/report.js';
import {
  AssertionUnavailable, count, text,
  type AssertionRow, type Collected, type ComputedAssertion,
} from './assertion.js';

/** Where an absent entry stands, said after "the kind does not offer it". */
const WHERE: Record<Verdict, string> = {
  offered: 'a reader finds it under another kind',
  held: 'the catalogue holds it and no reader sees it: it waits for a curator, was refused, or no longer stands',
  same_spot: 'something else stands at its spot, which may be the same place under another Wikidata item',
  missing_live: 'the catalogue does not hold it',
  // Never on a finding: an entry of a live kind is never only proposed or unsorted.
  missing_proposed: 'the catalogue does not hold it',
  unsorted: 'the catalogue does not hold it',
};

export const NOT_LOADED =
  'The expectation lists have not been loaded, so nothing is reported missing. A developer loads them '
  + 'with ./scripts/catalogue-coverage.sh load (docs/tech/catalogue-coverage.md).';

/** How much of what a survey expects one live kind offers, in one line. */
function kindLine(kind: CoverageReport['liveKinds'][number]): string {
  if (kind.expected === 0) return `${kind.name}: no survey expects anything of it yet.`;
  const offers = `${kind.name} offers ${kind.offered} of the ${kind.expected} expected of it`;
  const missing = kind.wellKnownMissing.length;
  if (missing === 0 && kind.belowLineMissing === 0) return `${offers}.`;
  if (kind.line === null) {
    const all = missing === 1 ? 'the one it lacks is' : `all ${missing} it lacks are`;
    return `${offers}; it draws no sitelinks line, so ${all} listed.`;
  }
  // Each half is said only when it holds something; both empty returned above.
  const lacks = missing === 1 ? '1 it lacks is' : `${missing} it lacks are`;
  const over = missing === 0
    ? `none it lacks is at or over its line of ${kind.line} sitelinks`
    : `${lacks} at or over its line of ${kind.line} sitelinks and listed`;
  if (kind.belowLineMissing === 0) return `${offers}; ${over}, and nothing it lacks sits under the line.`;
  const under = kind.belowLineMissing === 1 ? '1 under the line is' : `${kind.belowLineMissing} under the line are`;
  return `${offers}; ${over}, and ${under} the regional tier's to hold.`;
}

/** How many wait for a person, said in number. */
function waitingWords(waiting: number): string {
  if (waiting === 0) return 'none waits for a person';
  if (waiting === 1) return '1 waits for a person';
  return `${waiting} wait for a person`;
}

/** How many of what a kind lacks a person has judged, by cause, and how many wait for one. */
function judgedLine(kind: CoverageReport['liveKinds'][number]): string {
  const judged = kind.judgedByCause.reduce((sum, cause) => sum + cause.count, 0);
  const them = judged === 1 ? '1 of them is judged' : `${judged} of them are judged`;
  return ` ${them}: ${kind.judgedByCause.map(causeWords).join('; ')}; ${waitingWords(kind.wellKnownMissing.length - judged)}.`;
}

/**
 * The report's findings, one row per kind and entry a person has not judged, the most named
 * first, and after them one row per judgement whose gap has closed (ADR-0116).
 */
export function coverageFindings(report: CoverageReport): Collected {
  if (report.expectations.length === 0) throw new AssertionUnavailable(NOT_LOADED);
  const regionName = new Map(report.regions.map(region => [region.slug, region.name]));
  const rows: AssertionRow[] = report.liveKinds.flatMap(kind => kind.wellKnownMissing
    .filter(missing => missing.judgement === null)
    .map(missing => ({
      kind: kind.name,
      name: missing.name,
      region: regionName.get(missing.regionSlug) ?? missing.regionSlug,
      sources: missing.sourceCount,
      sitelinks: missing.sitelinks,
      verdict: missing.verdict,
    })));
  rows.sort((a, b) => count(b, 'sources') - count(a, 'sources')
    || count(b, 'sitelinks') - count(a, 'sitelinks')
    || text(a, 'name').localeCompare(text(b, 'name')));
  const stale: AssertionRow[] = report.staleJudgements.map(judgement => ({
    kind: judgement.kindName,
    name: judgement.name,
    region: regionName.get(judgement.regionSlug) ?? judgement.regionSlug,
    stale: judgement.cause,
    issue: judgement.issue,
    judged: judgement.judged,
  }));
  const context = report.liveKinds.map(kind => kindLine(kind) + (kind.judgedByCause.length > 0 ? judgedLine(kind) : ''));
  return { rows: [...rows, ...stale], context };
}

/** A judgement whose gap has closed, said as the thing to do about it. */
function describeStale(row: AssertionRow): string {
  return `${text(row, 'name')} (${text(row, 'region')}): judged ${text(row, 'stale')}${issueWords(row)} on ${text(row, 'judged')}, `
    + `and ${text(row, 'kind')} offers it now: the line comes out of judgements.jsonl.`;
}

const expectedWellKnownMissing: ComputedAssertion = {
  id: 'expected-and-well-known-yet-not-offered',
  area: 'coverage',
  title: 'A place or work travellers are sent to, well known by its kind\'s own rule, that the kind does not offer',
  kind: 'invariant',
  meaning:
    'The survey lists name what two or more independent guides recommend in each surveyed region. '
    + 'Each row is one that a live kind should hold by its own rule, being at or over the kind\'s '
    + 'sitelinks line (the number of Wikimedia sites with an article on it), or any for a kind that '
    + 'draws no line, and that the kind does not offer. A count that grows is a place the catalogue lost, '
    + 'unless the lists were extended or a judged gap closed. A row is answered by the kind\'s run or a curator, or, where the catalogue holds '
    + 'the place under another Wikidata item, by naming that item in the entry\'s same_as, or by a person judging '
    + 'why the gap stands, once per kind, in db/catalogue-coverage/judgements.jsonl: a defect of a rule, a door no rule has '
    + 'yet, a kind that does not exist, a part of a place the catalogue offers, a reader finding it under another kind, '
    + 'or not a must. A judged gap is counted by its cause beside the rows and listed no more; a judgement whose gap '
    + 'has since closed, the kind offering the entry now, is listed as a line to remove. Those under the line are the '
    + 'regional tier\'s, and are counted beside the rows rather than listed.',
  collect: async () => coverageFindings(await coverageReport()),
  describe: (row) => {
    if (row.stale !== undefined) return describeStale(row);
    const sitelinks = row.sitelinks === null || row.sitelinks === undefined ? '' : `, ${count(row, 'sitelinks')} sitelinks`;
    const where = WHERE[text(row, 'verdict') as Verdict] ?? WHERE.missing_live;
    return `${text(row, 'name')} (${text(row, 'region')}), named by ${count(row, 'sources')} sources${sitelinks}: `
      + `${text(row, 'kind')} does not offer it, and ${where}.`;
  },
};

/** How many a region offers that the ledger cannot key on, said after the ones that wait; nothing when none. */
function unjudgeableWords(unjudgeable: number): string {
  if (unjudgeable === 0) return '';
  if (unjudgeable === 1) return '; 1 has no Wikidata id to judge by';
  return `; ${unjudgeable} have no Wikidata id to judge by`;
}

/** How a region stands in the other direction, in one line: what it offers that no guide names, and what a person made of it. */
function regionLine(region: CoverageReport['unnamed'][number]): string {
  if (region.total === 0) return `${region.regionName}: everything it offers within its reach is named by a guide.`;
  const offers = `${region.regionName} offers ${region.total} within its reach that no guide names`;
  const judged = region.total - region.unjudged.length - region.unjudgeable.length;
  const unjudgeable = unjudgeableWords(region.unjudgeable.length);
  if (judged === 0) return `${offers}; ${waitingWords(region.unjudged.length)}${unjudgeable}.`;
  const them = judged === 1 ? '1 is judged' : `${judged} are judged`;
  return `${offers}; ${them}: ${region.judgedByCause.map(causeWords).join('; ')}; ${waitingWords(region.unjudged.length)}${unjudgeable}.`;
}

/**
 * The other direction's findings (#1601): one row per place a person judged not worth a
 * visit that a kind still offers, least known first within each region, and after them one
 * row per row judgement no offered place within reach carries. The unjudged are counted
 * beside the rows and listed by the command, since a person reads them in order there.
 */
export function unnamedFindings(report: CoverageReport): Collected {
  if (report.expectations.length === 0) throw new AssertionUnavailable(NOT_LOADED);
  const regionName = new Map(report.regions.map(region => [region.slug, region.name]));
  const rows: AssertionRow[] = report.unnamed.flatMap(region => region.standing.map(place => ({
    region: region.regionName,
    name: place.name,
    wikidata: place.wikidataId,
    kinds: place.kinds.join(', '),
    sitelinks: place.sitelinks,
    cause: place.judgement?.cause,
    issue: place.judgement?.issue ?? null,
    judged: place.judgement?.judged,
  })));
  const stale: AssertionRow[] = report.staleRowJudgements.map(judgement => ({
    region: regionName.get(judgement.regionSlug) ?? judgement.regionSlug,
    wikidata: judgement.wikidataId,
    stale: judgement.cause,
    issue: judgement.issue,
    judged: judgement.judged,
  }));
  return { rows: [...rows, ...stale], context: report.unnamed.map(regionLine) };
}

const issueWords = (row: AssertionRow): string => (row.issue === null || row.issue === undefined ? '' : ` (#${count(row, 'issue')})`);

const offeredNamedByNoGuide: ComputedAssertion = {
  id: 'offered-and-named-by-no-guide',
  area: 'coverage',
  title: 'A place a kind offers in a surveyed region that no guide names and a person judged not worth a visit',
  kind: 'invariant',
  meaning:
    'The survey lists are the yardstick in this direction too: a place a kind offers within a surveyed region\'s reach '
    + 'that no entry names, by its Wikidata id, an id named as the same place or UNESCO\'s id, is one a traveller was '
    + 'not sent to. Most such places are fine, and the coverage command lists them for a person least known first; '
    + 'each is judged once in db/catalogue-coverage/judgements.jsonl, worth a visit, not a must, or a defect of the '
    + 'rule that admitted it. A row here is one judged not worth a visit that a kind still offers: the kind\'s rule or a '
    + 'curator answers it, with a refusal or a raised line, and the row leaves when the place is no longer offered. '
    + 'A judgement no offered place within reach carries any more is listed as a line to remove. How many each '
    + 'region offers that no guide names, and how many wait for a person, is said beside the rows.',
  collect: async () => unnamedFindings(await coverageReport()),
  describe: (row) => {
    if (row.stale !== undefined) {
      return `Row ${text(row, 'wikidata')} (${text(row, 'region')}): judged ${text(row, 'stale')}${issueWords(row)} on ${text(row, 'judged')}, `
        + 'and no offered place within reach carries it now: the line comes out of judgements.jsonl.';
    }
    const sitelinks = row.sitelinks === null || row.sitelinks === undefined ? '' : `, ${count(row, 'sitelinks')} sitelinks`;
    return `${text(row, 'name')} (${text(row, 'region')}), ${text(row, 'kinds')}${sitelinks}: judged ${text(row, 'cause')}${issueWords(row)} `
      + `on ${text(row, 'judged')}, and the kind still offers it: its rule or a curator answers it.`;
  },
};

export const coverageAssertions: ComputedAssertion[] = [expectedWellKnownMissing, offeredNamedByNoGuide];
