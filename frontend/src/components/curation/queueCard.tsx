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

import { Box, Typography, Stack, Chip, Link } from '@mui/material';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { safeHref } from '../../utils/safeHref';
import { ObjectContext } from './ObjectContext';
import { SourceId, worldHeritagePartsHref } from './SourceId';

/**
 * How a part is named before its whole, on every card that names one: by the
 * reference the World Heritage list gives the component ("Component 1209-002
 * of …"), and as a part where it has none ("Part of …") (#1250, #2158).
 */
export function partOfLead(componentRef?: string | null): string {
  return componentRef ? `Component ${componentRef} of ` : 'Part of ';
}

/**
 * The serial site the object is a component of, linked to its page on the
 * World Heritage list (#2158), and to the list's table of its parts (#2183),
 * which the property's page does not show: the table is where a lost place, a
 * candidate item or a point placed roughly is decided. A component's own name
 * ("Zona nucleo 02, …") does not say it is one part of a property. Under it,
 * for a component the list numbers, what its row on the card is read from: the
 * reference, the name and the point the card shows are the catalogue's; the
 * table alone has the list's country and area, which the catalogue does not
 * hold. The point is `ObjectContext`'s, drawn after this line and only where
 * the object has one, so it is not called "above".
 */
function PartOfLine({ partOf }: { partOf: NonNullable<ReviewQueueItem['part_of']> }) {
  const href = safeHref(partOf.unesco_url);
  const partsHref = safeHref(worldHeritagePartsHref(partOf.unesco_id));
  return (
    <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: 1 }}>
      {partOfLead(partOf.component_ref)}
      {href ? (
        <Link href={href} target="_blank" rel="noopener noreferrer">{partOf.name}</Link>
      ) : partOf.name}
      {partsHref && (
        <>
          {' · '}
          <Link href={partsHref} target="_blank" rel="noopener noreferrer">the list of its parts</Link>
        </>
      )}
      {partOf.component_ref && (
        <Typography variant="caption" color="text.secondary" display="block">
          Reference {partOf.component_ref}, the name and the point the card shows are the catalogue’s;
          {partsHref ? ' the list’s country and area for it are in the table of parts.' : ' the list’s country and area are not held.'}
        </Typography>
      )}
    </Typography>
  );
}

/**
 * Which object a card is about, in the words a curator can judge it by.
 *
 * The name and the id say *which* object; `ObjectContext` says what it is — the picture,
 * the place, the page it came from. Both live here so every kind of card carries the
 * same amount, which is the property that made this module worth having.
 */
export function ItemHeader({ item, kinds = [item.kind_name] }: {
  item: ReviewQueueItem;
  /** Every kind the card asks for, one chip each — the item's own when omitted (#1264). */
  kinds?: string[];
}) {
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{item.name}</Typography>
        <SourceId id={item.external_id} kind={item.kind_name} sourcePage={item.unesco_url ?? item.website_url} />
        {kinds.map(kind => <Chip key={kind} label={kind} size="small" variant="outlined" />)}
      </Stack>
      {item.part_of && <PartOfLine partOf={item.part_of} />}
      <ObjectContext item={item} />
    </>
  );
}

/**
 * One labelled row of a queue card: what is waiting, and what it is called.
 *
 * Here rather than in either file that draws one, because the rows of a single
 * card are drawn from two now — the object's own held fields in
 * `WaitingToPublish`, its unread contents in `ArrivedTable` — and they stack in
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
