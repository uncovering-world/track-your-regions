/**
 * The pieces every card in the review queue is built from.
 *
 * Its own module for one reason: the queue's sections live in two files now —
 * `ReviewQueue.tsx` holds the four a run's own observations raise, and
 * `WaitingToPublish.tsx` the one a gated source raises — and both draw the same
 * header, describe values the same way and report a refusal in the same
 * sentence. Importing them from either page file would put a cycle between the
 * two, which `lint:circular` refuses and which reads as an accident to the next
 * person; a header duplicated in both would drift instead.
 */

import { Typography, Stack, Chip } from '@mui/material';
import type { ReviewQueueItem } from '../../api/experiences';
import { ObjectContext } from './ObjectContext';

/**
 * Which object a card is about, in the words a curator can judge it by.
 *
 * The name and the id say *which* object; `ObjectContext` says what it is — the picture,
 * the place, the page it came from. Both live here so every kind of card carries the
 * same amount, which is the property that made this module worth having.
 */
export function ItemHeader({ item }: { item: ReviewQueueItem }) {
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{item.name}</Typography>
        <Typography variant="caption" color="text.secondary">({item.external_id})</Typography>
        <Chip label={item.category_name} size="small" variant="outlined" />
      </Stack>
      <ObjectContext item={item} />
    </>
  );
}

/** What to tell the curator when their answer was refused. */
export function messageFor(item: { name: string }, error: unknown): string {
  return `${item.name}: ${error instanceof Error ? error.message : 'could not be saved'}`;
}

// `describe()` lived here and cut every value at 120 characters. It is gone rather than
// tightened: on Aksum it turned a decision between 200 characters of a curator's text and
// 511 from the source into two ellipses, and the screen's whole purpose is to show what
// the decision rests on. `FieldDiff` renders both values whole and marks the difference.
