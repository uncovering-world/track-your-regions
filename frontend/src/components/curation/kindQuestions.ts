/**
 * Whether a queue row's `missing` items are kinds of a place rather than the
 * place itself (#1264): a kind whose source stopped listing a place another
 * source still lists carries its membership; the place every source dropped
 * carries none. Its own module so the card, the bench and the batch's words
 * read one rule without importing a component.
 */

import type { ReviewQueueItem } from '../../api/reviewQueue';

export function asksOfKinds(items: readonly Pick<ReviewQueueItem, 'membership_id'>[] | undefined): boolean {
  return (items ?? []).some(item => item.membership_id != null);
}
