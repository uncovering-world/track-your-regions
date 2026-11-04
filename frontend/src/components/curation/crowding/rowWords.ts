/**
 * A crowded city's places in words (ADR-0180, #2282, #2358): the group's
 * title, why a place stands where it stands, as a hover says it, and the short
 * note under its name in the region's list.
 */

import type { CrowdingGroupPlace } from '../../../api/crowding';
import { typeNoun, typeWordFor } from '../../../utils/experienceTypes';

/** The rule a group's kind declares, as the words need it. */
export interface RuleWords { kindId: number; kindName: string; type: string | null; limit: number; radiusKm: number }

/** "Lazio · Places of worship · church": the region, the kind and the type. */
export function groupTitle(regionName: string | null, rule: Pick<RuleWords, 'kindId' | 'kindName' | 'type'>): string {
  const type = rule.type === null ? [] : [typeWordFor(rule.kindId, rule.type).toLowerCase()];
  return [regionName ?? 'No region', rule.kindName, ...type].join(' · ');
}

/** "churches", or "places" for the places of a kind with no type. */
export function nounOf(rule: Pick<RuleWords, 'kindId' | 'type'>, count: number): string {
  if (rule.type !== null) return typeNoun(rule.kindId, rule.type, count);
  return count === 1 ? 'place' : 'places';
}

/** "33 better-known churches": the rule's count for a place, as a sentence names it. */
export function betterWords(rule: RuleWords, count: number): string {
  return `${count} better-known ${nounOf(rule, count)}`;
}

/** "the Pantheon, St. Peter's Basilica, …": the best known of those above a place, and more where there are. */
function namedAbove(place: Pick<CrowdingGroupPlace, 'betterKnown' | 'outrankedBy'>): string {
  if (place.betterKnown.length === 0) return '';
  const more = (place.outrankedBy ?? 0) > place.betterKnown.length ? ', …' : '';
  return `: ${place.betterKnown.join(', ')}${more}`;
}

type Explained = Pick<
  CrowdingGroupPlace, 'standing' | 'crowded' | 'ruleCrowded' | 'pin' | 'holdsWorks' | 'outrankedBy' | 'betterKnown' | 'score'
>;

/**
 * Why a place stands where it stands, as a hover on the map or the list says
 * it: "shadowed: 33 better-known churches stand within 10 km of it: the
 * Pantheon, St. Peter's Basilica, …". A pin says the curator's answer first and
 * the rule's own reading after it, so a pin never hides the rule.
 */
export function whyWords(place: Explained, rule: RuleWords, typeExempt: boolean): string {
  const lead = place.standing === 'new' ? 'New, waiting for a curator' : '';
  const within = `within ${rule.radiusKm} km of it`;
  const counted = place.outrankedBy === null ? '' : `${betterWords(rule, place.outrankedBy)} stand ${within}${namedAbove(place)}`;
  // A list of names that runs on ends on its ellipsis, not on a full stop after it.
  const say = (reading: string) => {
    const said = lead ? `${lead}; ${reading}` : reading.charAt(0).toUpperCase() + reading.slice(1);
    return said.endsWith('….') ? said.slice(0, -1) : said;
  };
  if (typeExempt) return say(`always shown: ${rule.kindName} never hides a place of this type.`);
  if (place.holdsWorks) return say('always shown: it holds works a reader is shown.');
  if (place.pin === 'list') {
    const rule = place.ruleCrowded ? '; the rule would shadow it, as ' + counted : '';
    return say(`kept on the region page by a curator${rule}.`);
  }
  if (place.pin === 'shadow') {
    const rule = place.ruleCrowded ? '' : '; the rule would show it, as only ' + counted;
    return say(`kept in the shadow by a curator${rule}.`);
  }
  if (place.crowded) return say(`${place.standing === 'new' ? 'the rule would shadow it' : 'shadowed'}: ${counted}.`);
  if (place.score === null) return say('not measured yet, so the rule shows it until it is.');
  const fewer = `fewer than ${rule.limit} better-known ${nounOf(rule, 2)} stand ${within}`;
  return say(`${place.standing === 'new' ? 'the rule would show it' : 'on the region page'}: ${fewer}.`);
}

/**
 * The rule's reading of a place, as its card in its own circle says it, with
 * the place's exact count: a curator's pin first, then where the rule puts it,
 * then, for a new arrival, where it would sit once published.
 */
export function ruleReading(place: Explained, rule: RuleWords, typeExempt: boolean): string {
  if (typeExempt) return `The rule never hides it: ${rule.kindName} never hides a place of this type.`;
  if (place.holdsWorks) return 'The rule never hides it: it holds works a reader is shown.';
  let pin = '';
  if (place.pin === 'list') pin = 'A curator keeps it on the region page. ';
  if (place.pin === 'shadow') pin = 'A curator keeps it in the shadow. ';
  if (place.outrankedBy === null || place.score === null) {
    return `${pin}It is not measured yet, so the rule shows it until it is.`;
  }
  const count = place.outrankedBy;
  const within = `within ${rule.radiusKm} km of it`;
  const many = count === 0 ? 'no' : String(count);
  const verb = count === 1 ? 'stands' : 'stand';
  const reading = place.ruleCrowded
    ? `The rule shadows it: ${betterWords(rule, count)} stand ${within}.`
    : `The rule shows it: ${many} better-known ${nounOf(rule, count)} ${verb} ${within}, fewer than ${rule.limit}.`;
  let after = '';
  if (place.standing === 'new' && place.pin === null) {
    after = place.ruleCrowded
      ? ' Once published it would sit in the region page’s shadowed tail.'
      : ' Once published the region page would show it.';
  }
  return `${pin}${reading}${after}`;
}

/** The short note under a place's name in the region's list: "the best known here", "33 better known within 10 km". */
export function placeNote(place: Explained, rule: RuleWords, first: boolean): string | null {
  if (place.holdsWorks) return 'holds works, always shown';
  if (place.pin === 'list') return 'kept on the page by a curator';
  if (place.pin === 'shadow') return 'kept in the shadow by a curator';
  if (place.crowded && place.outrankedBy !== null) return `${place.outrankedBy} better known within ${rule.radiusKm} km`;
  if (first) return 'the best known here';
  if (place.standing === 'new') return 'the rule would show it';
  return null;
}

/** "58 shown · 62 shadowed · 6 new": what the group holds, as its line on the page says it. */
export function countsLine(places: readonly Pick<CrowdingGroupPlace, 'standing'>[]): string {
  const count = (standing: CrowdingGroupPlace['standing']) => places.filter(place => place.standing === standing).length;
  return `${count('shown')} shown · ${count('shadowed')} shadowed · ${count('new')} new`;
}

/** "2.9 km": a distance as a place's circle says it. */
export function distanceWords(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}
