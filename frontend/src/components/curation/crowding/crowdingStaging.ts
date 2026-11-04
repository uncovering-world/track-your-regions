/**
 * The crowded-city window's answers before they are applied (ADR-0180, #2282,
 * #2358): which a place takes by where it stands, what pressing one stages,
 * how the place is drawn with it, what the Apply bar says and what the report
 * of an Apply says.
 *
 * Each answer is a pin on the place itself, so a place answered in its own
 * circle and in the region's list is one answer. Pure, so the window's states
 * are tested without a map or a server. The staging is keyed by membership and
 * survives a move between the region's list and a place's circle: one Apply
 * sends every answer staged in the group.
 */

import type { CrowdingAnswer, CrowdingAnswered, CrowdingAnswerRow, CrowdingGroupPlace } from '../../../api/crowding';
import { plural } from '../../../utils/plural';
import { namedWithRest, outOfScopeClause, refusalClauses, stalePlacementClause } from '../../../utils/noticeClauses';
import { nounOf, type RuleWords } from './rowWords';

/** What a staged answer is said by: the place's name and where it stood when it was staged. */
export interface Staged {
  answer: CrowdingAnswer;
  name: string;
  standing: CrowdingGroupPlace['standing'];
  /** For a new arrival, whether the rule shadows it once passed. */
  crowded: boolean;
}

export type Staging = ReadonlyMap<number, Staged>;

/** How a place is drawn: its standing now, or the one a staged answer gives it. */
export type DrawnStanding = CrowdingGroupPlace['standing'] | 'refused';

/** What the window needs of a place to offer and stage its answers. */
export type Answerable = Pick<
  CrowdingGroupPlace, 'membershipId' | 'name' | 'standing' | 'crowded' | 'ruleCrowded' | 'pin' | 'pinnable' | 'canAnswer'
>;

/** One button: the answer it stages and what it says. */
export interface Offer { answer: CrowdingAnswer; label: string }

const DONT_TAKE: Offer = { answer: 'refuse', label: 'Don’t take' };
const BACK_TO_RULE: Offer = { answer: 'clear', label: 'Back to the rule' };

/**
 * The answers a place takes, by where it stands, as the region page would
 * place it: a place on the page can be shadowed; a shadowed one shown anyway
 * or kept shadowed; a new arrival the rule would show published, shadowed or
 * not taken, and one the rule would shadow shown anyway, kept shadowed or not
 * taken. A place holding works or of an exempt type takes no pin, and a pin is
 * handed back to the rule only where one is held. None outside the caller's
 * scope.
 */
export function answersOffered(place: Answerable): Offer[] {
  if (!place.canAnswer) return [];
  const pins = (offers: Offer[]) => (place.pinnable ? offers : []);
  const back = place.pin === null ? [] : [BACK_TO_RULE];
  if (place.standing === 'new') {
    if (!place.crowded) return [{ answer: 'publish', label: 'Publish' }, ...pins([{ answer: 'shadow', label: 'Shadow' }]), DONT_TAKE];
    return [...pins([{ answer: 'list', label: 'Show anyway' }, { answer: 'shadow', label: 'Keep shadowed' }]), DONT_TAKE];
  }
  if (place.standing === 'shown') return [...pins([{ answer: 'shadow', label: 'Shadow' }]), ...back];
  return [...pins([{ answer: 'list', label: 'Show anyway' }, { answer: 'shadow', label: 'Keep shadowed' }]), ...back];
}

/**
 * The staging after a press: a press on the staged answer takes it back, and a
 * press on what the place already holds — its pin — stages nothing, since
 * applying it would change nothing.
 */
export function stageAnswer(staging: Staging, place: Answerable, answer: CrowdingAnswer): Staging {
  const next = new Map(staging);
  const already = staging.get(place.membershipId)?.answer === answer || (place.standing !== 'new' && answer === place.pin);
  const offered = answersOffered(place).some(offer => offer.answer === answer);
  if (already || !offered) next.delete(place.membershipId);
  else next.set(place.membershipId, { answer, name: place.name, standing: place.standing, crowded: place.crowded });
  return next;
}

/** The answer a place's buttons show pressed: the staged one, else the pin it holds. */
export function chosenAnswer(place: Answerable, staging: Staging): CrowdingAnswer | null {
  return staging.get(place.membershipId)?.answer ?? place.pin;
}

/** Where the place is drawn: the standing a staged answer gives it, else its own. */
export function drawnStanding(place: Answerable, staging: Staging): DrawnStanding {
  switch (staging.get(place.membershipId)?.answer) {
    case 'list': return 'shown';
    case 'shadow': return 'shadowed';
    case 'publish': return place.crowded ? 'shadowed' : 'shown';
    case 'refuse': return 'refused';
    case 'clear':
      if (place.standing === 'new') return 'new';
      return place.ruleCrowded ? 'shadowed' : 'shown';
    default: return place.standing;
  }
}

/**
 * Which part of the region's list a place sits in, as its page would place it:
 * on the page, or in the shadowed tail. A new arrival sits where the rule
 * would put it once passed. Read off where it stands now, so a place does not
 * jump while its answer is only staged.
 */
export function listPart(place: Pick<CrowdingGroupPlace, 'standing' | 'crowded'>): 'page' | 'tail' {
  return place.crowded ? 'tail' : 'page';
}

/** What a staged answer does, in the Apply bar's words: "show Santa Maria Antiqua anyway". */
export function stagedWords({ answer, name, standing }: Staged): string {
  switch (answer) {
    case 'list': return `show ${name} anyway`;
    case 'shadow': return standing === 'shadowed' ? `keep ${name} shadowed` : `shadow ${name}`;
    case 'publish': return `publish ${name}`;
    case 'refuse': return `don’t take ${name}`;
    default: return `hand ${name} back to the rule`;
  }
}

/** The places the region page will show once the staged answers apply, before the rule recounts their neighbours. */
export function shownAfter(places: readonly Answerable[], staging: Staging): number {
  return places.filter(place => drawnStanding(place, staging) === 'shown').length;
}

/** The most staged answers the Apply bar names before it counts the rest. */
const NAMED_STAGED = 4;

/**
 * "2 answers staged: show Santa Maria Antiqua anyway, publish Cappella
 * Paolina. The region page will show 60 churches": what the staged answers
 * do, and how many places the region page shows once they apply. A pin moves
 * the neighbours it counts against too, which the recount says once it runs.
 */
export function applySummary(staging: Staging, places: readonly Answerable[], rule: Pick<RuleWords, 'kindId' | 'type'>): string {
  const said = [...staging.values()].map(stagedWords);
  const named = said.length > NAMED_STAGED
    ? `${said.slice(0, NAMED_STAGED).join(', ')} and ${said.length - NAMED_STAGED} more`
    : said.join(', ');
  const after = shownAfter(places, staging);
  return `${plural(staging.size, 'answer')} staged: ${named}. The region page will show ${after} ${nounOf(rule, after)}, `
    + 'before the rule recounts their neighbours.';
}

/** The body's rows, in the order they were staged. */
export function answerRows(staging: Staging): CrowdingAnswerRow[] {
  return [...staging].map(([membershipId, { answer }]) => ({ membershipId, answer }));
}

/** What an applied answer did, in the window's words. */
const DID: Record<CrowdingAnswer, string> = {
  list: 'shown anyway',
  shadow: 'kept in the shadow',
  publish: 'published and left to the rule',
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
    const publishedWords = published > 0 && answer !== 'publish' ? ` (${published} new, published)` : '';
    lines.push(`${plural(done.length, 'place')} ${DID[answer]}${publishedWords}: ${namedWithRest(done.map(row => row.name))}.`);
  }
  lines.push(...refusalClauses(result.refused.map(row => ({ name: row.name ?? `membership ${row.membershipId}`, error: row.error }))));
  lines.push(...outOfScopeClause(result.outOfScope));
  lines.push(...stalePlacementClause(result.placementFailed));
  if (lines.length === 0) lines.push('Nothing changed.');
  return lines;
}
