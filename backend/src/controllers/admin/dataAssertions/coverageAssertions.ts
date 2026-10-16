/**
 * What the catalogue lacks of what a traveller expects (#1162, ADR-0081).
 *
 * The other checks ask whether the rows the catalogue holds mean what the
 * product says. This one asks the opposite question, over the survey lists in
 * `db/catalogue-coverage/` once they are loaded: which expected places and works
 * a live kind does not offer although its own rule calls them well known. A sync
 * that loses the Frida Kahlo Museum makes this count grow, and nothing else in
 * the panel would see it.
 *
 * The decision is the coverage report's (`catalogueCoverage/report.ts`), which
 * the terminal command prints too; this file only says its findings the way the
 * panel says a row. Nothing here decides what is offered or where a kind's line
 * is.
 */

import { coverageReport, type CoverageReport, type Verdict } from '../catalogueCoverage/report.js';
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

/** The report's findings, one row per kind and entry, the most named first. */
export function coverageFindings(report: CoverageReport): Collected {
  if (report.expectations.length === 0) throw new AssertionUnavailable(NOT_LOADED);
  const regionName = new Map(report.regions.map(region => [region.slug, region.name]));
  const rows: AssertionRow[] = report.liveKinds.flatMap(kind => kind.wellKnownMissing.map(missing => ({
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
  return { rows, context: report.liveKinds.map(kindLine) };
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
    + 'unless the lists were extended. A row is answered by the kind\'s run or a curator, or, where the catalogue holds '
    + 'the place under another Wikidata item, by naming that item in the entry\'s same_as. Those under '
    + 'the line are the regional tier\'s, and are counted beside the rows rather than listed.',
  collect: async () => coverageFindings(await coverageReport()),
  describe: (row) => {
    const sitelinks = row.sitelinks === null || row.sitelinks === undefined ? '' : `, ${count(row, 'sitelinks')} sitelinks`;
    const where = WHERE[text(row, 'verdict') as Verdict] ?? WHERE.missing_live;
    return `${text(row, 'name')} (${text(row, 'region')}), named by ${count(row, 'sources')} sources${sitelinks}: `
      + `${text(row, 'kind')} does not offer it, and ${where}.`;
  },
};

export const coverageAssertions: ComputedAssertion[] = [expectedWellKnownMissing];
