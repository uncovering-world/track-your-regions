/**
 * The words of the way into the crowded-city window (ADR-0180, #2282): what
 * the button on a card says, read off the card's `crowding`. A row's own words
 * are `rowWords.ts`, in the window's chunk.
 */

import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { typePluralWord } from '../../../utils/experienceTypes';

/** The card's membership as the words name it: its kind and its type within the kind. */
type CardKind = Pick<ReviewQueueItem, 'kind_id' | 'kind_name' | 'kind_type'>;
/** How crowded the card's city is, as the queue's page reads it. */
type CardCrowding = NonNullable<ReviewQueueItem['crowding']>;

/** "Squares around (22)": the type's plural and how many places of it the window lists. */
export function aroundLabel(card: CardKind, crowding: CardCrowding): string {
  return `${typePluralWord(card.kind_id, card.kind_name, card.kind_type)} around (${crowding.around})`;
}

