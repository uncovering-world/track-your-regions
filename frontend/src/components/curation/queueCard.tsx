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

/** Which object a card is about, in the words a curator can judge it by. */
export function ItemHeader({ item }: { item: ReviewQueueItem }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{item.name}</Typography>
      <Typography variant="caption" color="text.secondary">({item.external_id})</Typography>
      <Chip label={item.category_name} size="small" variant="outlined" />
    </Stack>
  );
}

/** What to tell the curator when their answer was refused. */
export function messageFor(item: { name: string }, error: unknown): string {
  return `${item.name}: ${error instanceof Error ? error.message : 'could not be saved'}`;
}

/** Long values are described rather than reproduced, as in the run card. */
export function describe(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}… (${text.length} chars)` : text;
}
