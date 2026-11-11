/**
 * The words of the way into the crowded-city window (ADR-0180, #2282): what
 * the button on a card says, and what a shadowed place's card says of the
 * places above it, both read off the card's `crowding`. A row's own words are
 * `rowWords.ts`, in the window's chunk.
 */

import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { typeNoun, typePluralWord } from '../../../utils/experienceTypes';

/** The card's membership as the words name it: its kind and its type within the kind. */
type CardKind = Pick<ReviewQueueItem, 'kind_id' | 'kind_name' | 'kind_type'>;
/** How crowded the card's city is, as the queue's page reads it. */
type CardCrowding = NonNullable<ReviewQueueItem['crowding']>;

/** "Squares around (22)": the type's plural and how many places of it the window lists. */
export function aroundLabel(card: CardKind, crowding: CardCrowding): string {
  return `${typePluralWord(card.kind_id, card.kind_name, card.kind_type)} around (${crowding.around})`;
}

/**
 * What a shadowed place's card says (#2228): that it is shadowed, in which
 * kind, and how many better-known places of its type outrank it, as the
 * recount counted them; the window names them. Fewer than the kind's limit
 * means a curator kept it in the shadow, which the line says. A new arrival
 * reads as one the rule would shadow once published. Null for a place the
 * display shows.
 */
export function shadowLine(card: CardKind & Pick<ReviewQueueItem, 'curation_state'>, crowding: CardCrowding): string | null {
  if (!crowding.shadowed || crowding.outrankedBy === null) return null;
  const n = crowding.outrankedBy;
  const count = `${n} better-known ${typeNoun(card.kind_id, card.kind_type, n)} within ${crowding.radiusKm} km`;
  if (n < crowding.limit) {
    return `Kept in the shadow of ${card.kind_name} by a curator; ${count} ${n === 1 ? 'counts' : 'count'} above it.`;
  }
  const lead = card.curation_state === 'pending' ? `Once published, shadowed in ${card.kind_name}` : `Shadowed in ${card.kind_name}`;
  return `${lead}: ${count} outrank it.`;
}

/**
 * What a place not measured yet is told (#2420): it is measured at the end of
 * the run in progress, whose after-step measures every place, or of the next
 * one. A place no run can measure, one a curator made by hand with no
 * Wikidata item, is never measured, and is told so. Until it is, only the
 * places a curator keeps on the list count above it (`crowding_above()`), and
 * `kept` says how many.
 */
export function notMeasuredLine(measurable: boolean, measuringRun: string | null, kept = 0): string {
  const keptOnes = kept === 1 ? 'the one a curator keeps on the list counts' : `the ${kept} a curator keeps on the list count`;
  const what = kept === 0 ? 'nothing is compared with it' : `only ${keptOnes} above it`;
  if (!measurable) return `Never measured: it has no Wikidata item, so ${what}.`;
  const when = measuringRun ? `until the run of ${measuringRun} in progress ends` : 'until the next sync run ends';
  return `Not measured yet: ${what} ${when}.`;
}

/**
 * The card's line where the rule found nothing above the place, or where it
 * has not measured the place yet (#2420); a shadowed place's line otherwise
 * (`shadowLine`). Null where the place is shown with better-known places
 * around it, which the window lists.
 */
export function circleLine(card: CardKind & Pick<ReviewQueueItem, 'curation_state'>, crowding: CardCrowding): string | null {
  // A curator's shadow is said first: a place kept there is still kept there while it waits to be measured.
  if (!crowding.measured) {
    const notMeasured = notMeasuredLine(crowding.measurable, crowding.measuringRun, crowding.betterKnown ?? 0);
    const shadow = shadowLine(card, crowding);
    return shadow ? `${shadow} ${notMeasured}` : notMeasured;
  }
  if (!crowding.shadowed && crowding.betterKnown === 0) {
    return `No better-known ${typeNoun(card.kind_id, card.kind_type, 1)} stands within ${crowding.radiusKm} km of it.`;
  }
  return shadowLine(card, crowding);
}
