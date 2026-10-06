/**
 * What a gated source is holding, and the one answer it has.
 *
 * Three of the queue's kinds come from a source that may not publish on its own
 * say (ADR-0025): an **arrival** nobody has passed, a **held** proposal against
 * a row readers already see, and **contents** — unread points and works under a
 * row that is visible. They share one sentence — nothing here has reached a
 * visitor — so they share one section rather than taking three.
 *
 * They do not share one row, and that is the whole shape of this file. The API
 * answers `held` and `contents` as two rows so each query stays simple; a museum
 * whose label is held *and* which gained twelve paintings is one object and one
 * decision to the curator looking at it, so the grouping happens here.
 *
 * A place in two kinds can be asked about by both (#1264): an Archaeology run
 * brings the Capitoline Museums while their Art Museums membership holds a new
 * picture. That is still one place and one row, but two questions, each
 * answered under its own kind's membership — so the card draws the place once
 * and a section per kind (`GatedSection.tsx`), and a place in one kind reads
 * exactly as it did.
 *
 * Every button on these cards calls `POST /:id/publish`, never `accept-source`.
 * That endpoint's lookup requires `curatedConflict: true` on the field, which a
 * field held purely by the gate does not have — nobody claimed it, the gate
 * refused it — so it would answer 409 to every click. A field the curator *has*
 * claimed is a different question with a different answer, and keeps its own
 * `conflict` card: the same museum can legitimately appear under both.
 */

import { useState } from 'react';
import { Button, Card, CardContent, Stack } from '@mui/material';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { ItemHeader } from './queueCard';
import { ObjectPreview } from './ObjectPreview';
import { GatedSection } from './GatedSection';
import { sectionKind, type GatedGroup } from './gatedGroup';

/**
 * Each place's open questions, a section per membership that asks, in the
 * order the places first appear.
 *
 * Which halves share a section is measured against the queries rather than
 * assumed: `held` fires only where the membership's `curation_state <>
 * 'pending'` (#822), so **an arrival is always alone** in its section; unread
 * contents name the membership they belong to (the backend's
 * `contentsMembershipSql`), so where that membership also holds a proposal
 * they share its section — the source wants to change the label *and* the
 * museum gained twelve paintings. A second section exists only where a second
 * kind asks.
 */
export function groupGated(
  arrivals: ReviewQueueItem[], held: ReviewQueueItem[], contents: ReviewQueueItem[],
): Map<number, GatedGroup[]> {
  const byMembership = new Map<string, GatedGroup>();
  const put = (item: ReviewQueueItem, key: 'arrival' | 'held' | 'contents') => {
    const at = `${item.id}:${item.membership_id ?? ''}`;
    const group = byMembership.get(at)
      ?? { id: item.id, name: item.name, membershipId: item.membership_id ?? null };
    byMembership.set(at, { ...group, [key]: item });
  };
  arrivals.forEach(item => put(item, 'arrival'));
  held.forEach(item => put(item, 'held'));
  contents.forEach(item => put(item, 'contents'));
  const byPlace = new Map<number, GatedGroup[]>();
  for (const group of byMembership.values()) byPlace.set(group.id, [...(byPlace.get(group.id) ?? []), group]);
  return byPlace;
}

/**
 * One place's card: its header once, then a section per kind that asks.
 *
 * `ReviewBench` mounts this without a key, deliberately — the object preview
 * staying open as a curator works down the queue is the behaviour
 * `ObjectPreview` is written around — so the preview's toggle lives here,
 * while each section is keyed on its place and membership and starts afresh on
 * the next row.
 */
export function GatedCard({ sections, onDone }: { sections: GatedGroup[]; onDone: (message?: string) => void }) {
  const [showObject, setShowObject] = useState(false);
  const first = sections[0];
  const item = (first.arrival ?? first.held ?? first.contents)!;
  const several = sections.length > 1;
  const objectButton = (
    <Button variant="text" onClick={() => setShowObject(v => !v)}>
      {showObject ? 'Hide the object' : 'Look at the object'}
    </Button>
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} kinds={several ? sections.map(sectionKind) : undefined} />
        <Stack spacing={2}>
          {sections.map((group, index) => (
            <GatedSection
              key={`${group.id}:${group.membershipId ?? ''}`}
              group={group}
              heading={several ? `${sectionKind(group)} asks` : undefined}
              objectButton={index === sections.length - 1 ? objectButton : undefined}
              onDone={onDone}
            />
          ))}
        </Stack>
        {showObject && <ObjectPreview experienceId={first.id} />}
      </CardContent>
    </Card>
  );
}
