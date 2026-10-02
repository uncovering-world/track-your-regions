/**
 * The coverage report as text a person and an agent read in a terminal (ADR-0081).
 *
 * Plain lines, no table drawing: the report is pasted into issues and read by
 * tools, and a column of numbers survives both.
 */

import type { CoverageReport, ExpectationResult, LiveKindGaps, NearbyPoint, Verdict } from './report.js';

const VERDICT_WORDS: Record<Verdict, string> = {
  offered: 'offered to a reader',
  held: 'in the catalogue, not offered',
  same_spot: 'something else at its spot',
  missing_live: 'absent, kind exists',
  missing_proposed: 'absent, kind proposed',
  unsorted: 'absent, not sorted',
};

const share = (part: number, whole: number): string => (whole === 0 ? '0%' : `${Math.round((100 * part) / whole)}%`);

function regionLines(report: CoverageReport): string[] {
  const lines = ['By region', ''];
  for (const region of report.regions) {
    lines.push(`${region.name}, ${region.country} (surveyed ${region.surveyed}): ${region.total} expected, `
      + `${region.counts.offered} offered (${share(region.counts.offered, region.total)})`);
    for (const verdict of ['held', 'same_spot', 'missing_live', 'missing_proposed', 'unsorted'] as const) {
      if (region.counts[verdict] > 0) lines.push(`    ${String(region.counts[verdict]).padStart(4)}  ${VERDICT_WORDS[verdict]}`);
    }
  }
  return lines;
}

function proposedLines(report: CoverageReport): string[] {
  const lines = ['What the surveys expect of kinds the product does not have', '(most regions first, then most entries)', ''];
  for (const kind of report.proposedKinds) {
    const owner = kind.issue === null ? 'no issue' : `#${kind.issue}`;
    const elsewhere = kind.offeredElsewhere > 0 ? `, ${kind.offeredElsewhere} already offered through another kind` : '';
    const holds = kind.inVenue ? `${kind.form}, inside a place` : kind.form;
    lines.push(`${kind.name} [${kind.slug}; holds: ${holds}; ${owner}]`);
    lines.push(`    ${kind.expected} expected in ${kind.regions} region(s)${elsewhere}`);
    lines.push(`    such as: ${kind.examples.join('; ')}`);
  }
  if (report.proposedKinds.length === 0) lines.push('(nothing is filed under a proposed kind)');
  return lines;
}

/** One thing a live kind lacks, said with where a reader does or does not see it. */
function missingLine(missing: LiveKindGaps['wellKnownMissing'][number]): string {
  // Offered, and absent from this kind: a reader sees it under another one.
  const where = missing.verdict === 'offered' ? 'offered through another kind' : VERDICT_WORDS[missing.verdict];
  const sitelinks = missing.sitelinks ?? 'no';
  return `        ${missing.name} (${missing.regionSlug}; ${sitelinks} sitelinks; ${missing.sourceCount} sources; ${where})`;
}

function liveKindLines(kind: LiveKindGaps): string[] {
  const line = kind.line === null ? 'no sitelinks line' : `line: ${kind.line} sitelinks`;
  const lines = [`${kind.name} [${kind.slug}; ${line}]: ${kind.offered} of ${kind.expected} expected are offered`];
  if (kind.wellKnownMissing.length > 0) {
    lines.push(kind.line === null ? '    absent:' : '    absent and at or over the line:', ...kind.wellKnownMissing.map(missingLine));
  }
  if (kind.belowLineMissing > 0) lines.push(`    absent and under the line: ${kind.belowLineMissing}`);
  return lines;
}

function liveLines(report: CoverageReport): string[] {
  return ['What each live kind lacks of what is expected of it', '', ...report.liveKinds.flatMap(liveKindLines)];
}

/** A catalogue point at an expectation's spot: the place, its named point where it has one, and how far. */
function nearbyWords(near: NearbyPoint): string {
  const point = near.point && near.point !== near.place ? ` / ${near.point}` : '';
  return `${near.place}${point} (${near.metres} m)`;
}

function judgedLines(title: string, entries: ExpectationResult[], say: (entry: ExpectationResult) => string): string[] {
  if (entries.length === 0) return [];
  return [title, '', ...entries.map(entry => `${entry.regionSlug}: ${entry.name}${say(entry)}`), ''];
}

export function renderCoverageReport(report: CoverageReport): string {
  const total = report.expectations.length;
  const offered = report.expectations.filter(entry => entry.verdict === 'offered').length;
  const sameSpot = report.expectations.filter(entry => entry.verdict === 'same_spot');
  const held = report.expectations.filter(entry => entry.verdict === 'held');
  const unsorted = report.expectations.filter(entry => entry.verdict === 'unsorted');
  return [
    `Catalogue coverage: ${offered} of ${total} expected things are offered to a reader (${share(offered, total)}), `
      + `across ${report.regions.length} surveyed region(s).`,
    '',
    ...regionLines(report),
    '',
    ...proposedLines(report),
    '',
    ...liveLines(report),
    '',
    ...judgedLines(
      'Something else stands at the spot: for a person to judge, never counted as found',
      sameSpot,
      entry => ` -> ${entry.nearby.slice(0, 3).map(nearbyWords).join('; ')}`,
    ),
    ...judgedLines(
      'In the catalogue and not offered to a reader',
      held,
      entry => ` -> ${entry.matches.map(match => match.catalogue_name).join('; ')}`,
    ),
    ...judgedLines('Not sorted into a kind yet', unsorted, entry => ` [${entry.type}]`),
  ].join('\n').trimEnd();
}
