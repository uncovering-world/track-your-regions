/**
 * The pieces every card in the review queue is built from.
 *
 * Its own module for one reason: the queue's sections are spread over several
 * files, grouped by what raises them — `ReviewQueue.tsx` for a run's own
 * observations, `WaitingToPublish.tsx` for what a gated source raises,
 * `WithdrawnPoints.tsx` for a verdict asked per point — and every one of them
 * draws the same header, describes values the same way and reports a refusal in
 * the same sentence. Importing those pieces from any one of the page files would
 * put a cycle between them, which `lint:circular` refuses and which reads as an
 * accident to the next person; a header duplicated per file would drift instead.
 *
 * Stated as a class and not a tally on purpose: the next card file is a section
 * added, not this sentence to renumber. It imports from here like the rest.
 */

import { Box, Typography, Stack, Chip } from '@mui/material';
import type { ReviewQueueItem } from '../../api/experiences';
import { ObjectContext } from './ObjectContext';
import { SourceId } from './SourceId';

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
        <SourceId id={item.external_id} category={item.category_name} sourcePage={item.website_url} />
        <Chip label={item.category_name} size="small" variant="outlined" />
      </Stack>
      <ObjectContext item={item} />
    </>
  );
}

/**
 * One labelled row of a queue card: what is waiting, and what it is called.
 *
 * Here rather than in either file that draws one, because the rows of a single
 * card are drawn from two now — the object's own held fields in
 * `WaitingToPublish`, its unread contents in `GatedContents` — and they stack in
 * the same column. The 56px label gutter is what lines them up, so it is one
 * decision: kept in two copies it would drift the first time a longer label
 * needed room, and nothing would fail.
 */
export function GatedRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={2} alignItems="flex-start">
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 56, pt: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

/** What to tell the curator when their answer was refused. */
export function messageFor(item: { name: string }, error: unknown): string {
  return `${item.name}: ${error instanceof Error ? error.message : 'could not be saved'}`;
}

// `describe()` lived here and cut every value at 120 characters. It is gone rather than
// tightened: on Aksum it turned a decision between 200 characters of a curator's text and
// 511 from the source into two ellipses, and the screen's whole purpose is to show what
// the decision rests on. `FactTable` renders both values whole and marks the difference.
