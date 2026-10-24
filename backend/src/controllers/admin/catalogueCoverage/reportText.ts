/**
 * The coverage report as text a person and an agent read in a terminal (ADR-0081).
 *
 * Plain lines, no table drawing: the report is pasted into issues and read by
 * tools, and a column of numbers survives both.
 */

import {
  causeWords,
  type CalibrationStanding, type CalibrationTop, type CoverageReport, type ExpectationResult, type LiveKindGaps, type NearbyPoint,
  type UnnamedPlace, type Verdict,
} from './report.js';

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
  // The judged are counted and the rest named: a person reads what nobody has answered for.
  const unjudged = kind.wellKnownMissing.filter(missing => missing.judgement === null);
  if (unjudged.length > 0) {
    lines.push(kind.line === null ? '    absent, not judged:' : '    absent and at or over the line, not judged:', ...unjudged.map(missingLine));
  }
  if (kind.judgedByCause.length > 0) {
    const judged = kind.wellKnownMissing.length - unjudged.length;
    lines.push(`    absent and judged: ${judged}: ${kind.judgedByCause.map(causeWords).join('; ')}`);
  }
  if (kind.belowLineMissing > 0) lines.push(`    absent and under the line: ${kind.belowLineMissing}`);
  return lines;
}

function liveLines(report: CoverageReport): string[] {
  return ['What each live kind lacks of what is expected of it', '', ...report.liveKinds.flatMap(liveKindLines)];
}

const STANDING_WORDS: Record<Exclude<CalibrationStanding, 'offered'>, string> = {
  held: 'in the catalogue, not offered by this kind',
  refused: 'refused by the last run',
  under_line: 'absent, under the editions line',
  absent: 'absent, not a candidate the last run named',
};

/** One top a kind does not offer: how known it is, which lists name it, and why it is missed. */
function missLine(top: CalibrationTop): string {
  const sitelinks = top.sitelinks ?? 'no';
  const detail = top.detail === null ? '' : `: ${top.detail}`;
  return `        ${top.name} (${top.wikidataId}; ${sitelinks} sitelinks; ${top.sources.join(', ')}; ${STANDING_WORDS[top.standing as Exclude<CalibrationStanding, 'offered'>]}${detail})`;
}

/** A live kind against its own calibration list (#1864): the share offered, each reference list's share, and every miss. */
function calibrationLines(kind: LiveKindGaps): string[] {
  const own = kind.calibration;
  if (own === null) return [];
  const lines = [`${kind.name} [${kind.slug}]: ${own.offered} of ${own.entries} tops are offered`];
  for (const source of own.bySource) lines.push(`    ${source.name}: ${source.offered} of ${source.named}`);
  if (own.misses.length > 0) lines.push('    not offered:', ...own.misses.map(missLine));
  return lines;
}

function calibrationSection(report: CoverageReport): string[] {
  const listed = report.liveKinds.filter(kind => kind.calibration !== null);
  if (listed.length === 0) return [];
  return ['What each live kind offers of the tops a traveller expects of it: its fame line, checked', '', ...listed.flatMap(calibrationLines), ''];
}

const owner = (issue: number | null): string => (issue === null ? '' : ` (#${issue})`);

/** The judgements whose gap has closed, and the row judgements no offered row carries: each a line to remove from the ledger. */
function staleLines(report: CoverageReport): string[] {
  if (report.staleJudgements.length === 0 && report.staleRowJudgements.length === 0) return [];
  return [
    'Judgements whose gap has closed: the kind offers the entry now, or no offered row within reach carries the id, so the line comes out of judgements.jsonl',
    '',
    ...report.staleJudgements.map(stale => `${stale.regionSlug}: ${stale.name} under ${stale.kindSlug} -> ${stale.cause}${owner(stale.issue)}, judged ${stale.judged}`),
    ...report.staleRowJudgements.map(stale => `${stale.regionSlug}: row ${stale.wikidataId} -> ${stale.cause}${owner(stale.issue)}, judged ${stale.judged}`),
    '',
  ];
}

/** One offered place no guide names: what it is, which kinds offer it, how known it is, how far from the centre. */
function unnamedLine(place: UnnamedPlace): string {
  const id = place.wikidataId ?? 'no Wikidata id';
  const sitelinks = place.sitelinks === null ? 'no sitelinks count' : `${place.sitelinks} sitelinks`;
  return `        ${place.name} (${id}; ${place.kinds.join(', ')}; ${sitelinks}; ${place.km} km)`;
}

/** Per region, what it offers that no guide names: the unjudged least known first, the judged by cause, and the findings that stand. */
function unnamedLines(report: CoverageReport): string[] {
  const lines = ['Offered within reach and named by no guide: for a person to judge, least known first', ''];
  for (const region of report.unnamed) {
    const judged = region.total - region.unjudged.length - region.unjudgeable.length;
    const causes = region.judgedByCause.length > 0 ? `: ${region.judgedByCause.map(causeWords).join('; ')}` : '';
    const unjudgeable = region.unjudgeable.length > 0 ? `; ${region.unjudgeable.length} cannot be judged (no Wikidata id)` : '';
    lines.push(`${region.regionName} [${region.regionSlug}]: ${region.total} offered that no entry names; ${judged} judged${causes}; `
      + `${region.unjudged.length} wait for a person${unjudgeable}`);
    if (region.unjudged.length > 0) lines.push('    not judged:', ...region.unjudged.map(unnamedLine));
    if (region.unjudgeable.length > 0) lines.push('    no Wikidata id to judge by:', ...region.unjudgeable.map(unnamedLine));
    if (region.standing.length > 0) lines.push('    judged not worth a visit and still offered:', ...region.standing.map(unnamedLine));
  }
  return lines;
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
    ...calibrationSection(report),
    ...unnamedLines(report),
    '',
    ...staleLines(report),
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
