/**
 * The crowded-city window's answers before they are applied (ADR-0180, #2282):
 * which a row may take, what pressing one stages, how the row is drawn with it,
 * what the footer counts, and what the report of an Apply says.
 *
 * Pure, so the window's states are tested without a map or a server. The
 * staging is keyed by membership and survives a switch of type or of the place
 * the window stands on: one Apply sends every answer staged in the city.
 */

import type { CrowdingAnswer, CrowdingAnswered, CrowdingAnswerRow, CrowdingWindowRow } from '../../../api/crowding';
import { plural } from '../../../utils/plural';
import { namedWithRest, outOfScopeClause, refusalClauses, stalePlacementClause } from '../../../utils/noticeClauses';

/** One staged answer, with what the footer and the report name it by. */
export interface Staged {
  answer: CrowdingAnswer;
  name: string;
  /** Whether the row was a new arrival when the answer was staged. */
  arriving: boolean;
}

export type Staging = ReadonlyMap<number, Staged>;

/** How a row is drawn: its standing now, or the one a staged answer gives it. */
export type DrawnStanding = CrowdingWindowRow['standing'] | 'refused';

/** Which answers a row takes. A place holding works or of an exempt type takes no pin, and a pin is cleared only where one is held. */
export function answersOffered(row: CrowdingWindowRow): Record<CrowdingAnswer, boolean> {
  const pinnable = row.canAnswer && row.pinnable;
  return { list: pinnable, shadow: pinnable, refuse: row.canAnswer, clear: row.canAnswer && row.pin !== null };
}

/**
 * The staging after a press: a press on the staged answer takes it back, and a
 * press on what the row already holds — its pin, or no pin for Clear — stages
 * nothing, since applying it would change nothing.
 */
export function stageAnswer(staging: Staging, row: CrowdingWindowRow, answer: CrowdingAnswer): Staging {
  const next = new Map(staging);
  const already = staging.get(row.membershipId)?.answer === answer
    || (row.standing !== 'new' && answer === row.pin)
    || (answer === 'clear' && row.pin === null);
  if (already || !answersOffered(row)[answer]) next.delete(row.membershipId);
  else next.set(row.membershipId, { answer, name: row.name, arriving: row.standing === 'new' });
  return next;
}

/** The answer a row's buttons show pressed: the staged one, else the pin it holds. */
export function chosenAnswer(row: CrowdingWindowRow, staging: Staging): CrowdingAnswer | null {
  return staging.get(row.membershipId)?.answer ?? row.pin;
}

/** Where the row is drawn: the standing a staged answer gives it, else its own. */
export function drawnStanding(row: CrowdingWindowRow, staging: Staging): DrawnStanding {
  switch (staging.get(row.membershipId)?.answer) {
    case 'list': return 'listed';
    case 'shadow': return 'shadowed';
    case 'refuse': return 'refused';
    case 'clear':
      if (row.standing === 'new') return 'new';
      return row.ruleCrowded ? 'shadowed' : 'listed';
    default: return row.standing;
  }
}

/**
 * Where the line marking the rule's ten is drawn: before the first row, best
 * known first, that the rule shadows whatever its own pin says. -1 where the
 * rule shadows none of them.
 */
export function ruleLineAt(rows: readonly CrowdingWindowRow[]): number {
  return rows.findIndex(row => row.ruleCrowded);
}

/** What the footer counts: the new arrivals and how many are answered, and the changes to places already in. */
export function stagingSummary(rows: readonly CrowdingWindowRow[], staging: Staging) {
  const arriving = rows.filter(row => row.standing === 'new');
  return {
    arrivals: arriving.length,
    arrivalsAnswered: arriving.filter(row => staging.has(row.membershipId)).length,
    admittedChanged: [...staging.values()].filter(staged => !staged.arriving).length,
    staged: staging.size,
  };
}

/** The body's rows, in the order they were staged. */
export function answerRows(staging: Staging): CrowdingAnswerRow[] {
  return [...staging].map(([membershipId, { answer }]) => ({ membershipId, answer }));
}

/** What an applied answer did, in the window's words. */
const DID: Record<CrowdingAnswer, string> = {
  list: 'kept in the list',
  shadow: 'kept in the shadow',
  refuse: 'not taken',
  clear: 'handed back to the rule',
};

/**
 * The report of an Apply, as lines: what was answered, by answer, naming the
 * places; then what the server refused and why, what landed outside the
 * curator's scope, and what published but could not be re-placed.
 */
export function outcomeLines(result: CrowdingAnswered): string[] {
  const lines: string[] = [];
  for (const answer of Object.keys(DID) as CrowdingAnswer[]) {
    const done = result.answered.filter(row => row.answer === answer);
    if (done.length === 0) continue;
    const published = done.filter(row => row.published).length;
    const publishedWords = published > 0 ? ` (${published} new, published)` : '';
    lines.push(`${plural(done.length, 'place')} ${DID[answer]}${publishedWords}: ${namedWithRest(done.map(row => row.name))}.`);
  }
  lines.push(...refusalClauses(result.refused.map(row => ({ name: row.name ?? `membership ${row.membershipId}`, error: row.error }))));
  lines.push(...outOfScopeClause(result.outOfScope));
  lines.push(...stalePlacementClause(result.placementFailed));
  if (lines.length === 0) lines.push('Nothing changed.');
  return lines;
}
