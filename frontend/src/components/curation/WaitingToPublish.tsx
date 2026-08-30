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
 * Every button on these cards calls `POST /:id/publish`, never `accept-source`.
 * That endpoint's lookup requires `curatedConflict: true` on the field, which a
 * field held purely by the gate does not have — nobody claimed it, the gate
 * refused it — so it would answer 409 to every click. A field the curator *has*
 * claimed is a different question with a different answer, and keeps its own
 * `conflict` card: the same museum can legitimately appear under both.
 */

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Stack, Divider,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  publishExperience,
  type HeldPart,
  type PublishRequest,
  type ReviewQueueItem,
} from '../../api/experiences';
import { plural } from '../../utils/plural';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { ItemHeader, messageFor } from './queueCard';
import { FactTable, ProposalSummary } from './FactTable';
import { partGroups, rowsFor } from './factRows';
import { ObjectPreview } from './ObjectPreview';
import { publishOutcomeFor } from './publishOutcome';
import { PartPreviewDialog } from './PartPreviewDialog';

/** One experience, with whatever a gated run left open about it. */
export interface GatedGroup {
  id: number;
  name: string;
  arrival?: ReviewQueueItem;
  held?: ReviewQueueItem;
  contents?: ReviewQueueItem;
}

/**
 * One group per experience, however many of the three kinds name it.
 *
 * Only one pair can actually occur, measured against the queries rather than
 * assumed: `held` fires only where `curation_state <> 'pending'` and `contents`
 * hides a `pending` container outright, so an **arrival is always alone** and the
 * grouping exists for `held` + `contents` — the source wants to change the label
 * *and* the museum gained twelve paintings.
 */
export function groupGated(
  arrivals: ReviewQueueItem[], held: ReviewQueueItem[], contents: ReviewQueueItem[],
): GatedGroup[] {
  const byId = new Map<number, GatedGroup>();
  const put = (item: ReviewQueueItem, key: 'arrival' | 'held' | 'contents') => {
    const group = byId.get(item.id) ?? { id: item.id, name: item.name };
    byId.set(item.id, { ...group, [key]: item });
  };
  arrivals.forEach(item => put(item, 'arrival'));
  held.forEach(item => put(item, 'held'));
  contents.forEach(item => put(item, 'contents'));
  return [...byId.values()];
}

/**
 * The counts, as numbers and as a floor under the query that casts them.
 *
 * `COUNT(...)` is `bigint` and `pg` returns those as strings, so the queue casts
 * both counts to `int` — measured, not assumed: before the cast this arrived as
 * `"1"`. Coercion here costs one call and covers the plural rule below, which is
 * the part arithmetic coercion would not: it compares against 1, and `'1' === 1`
 * is false, so a raw bigint would have a curator reading "1 points".
 */
function count(value: number | undefined): number {
  return Number(value ?? 0);
}

/**
 * One experience's card: what is open about it, and the button that answers.
 *
 * Follows `MissingCard`'s idiom, `onSettled` included — the refetch runs whether
 * the call succeeded or not, because a failure usually means the server has
 * already answered and this page is the stale one, and a card left standing
 * would let every further click repeat the same refusal.
 */
export function GatedCard({ group, onDone }: { group: GatedGroup; onDone: (message?: string) => void }) {
  const { arrival, held, contents } = group;
  const item = arrival ?? held ?? contents!;
  const queryClient = useQueryClient();
  const [showObject, setShowObject] = useState(false);
  // Which part is open, held as the part rather than a flag: the card is mounted
  // unkeyed, and a flag would carry one object's open work onto the next.
  const [openPart, setOpenPart] = useState<HeldPart | null>(null);
  const proposed = held?.proposed ?? [];
  const context = { proposed, inDanger: item.in_danger, dangerSince: item.danger_since };
  const rows = rowsFor(proposed, context);
  // The held fields of the object's parts, one group per part under the object's
  // own (ADR-0037): a change inside a part is a change on the object's card, not
  // a separate queue. The summary counts every row, since a curator deciding
  // whether to publish is deciding about all of it.
  const parts = partGroups(
    held?.proposed_parts ?? [], context, { offeredLocations: item.offered_locations }, setOpenPart,
  );
  const partRows = parts.flatMap(group => group.rows);
  const points = count(contents?.pending_locations);
  const works = count(contents?.pending_treasures);

  const publish = useMutation({
    mutationFn: (body?: PublishRequest) => publishExperience(group.id, body ?? publishBodyFor(group)),
    // Say what landed. The refetch takes the card away, so this is the only
    // place a released withdrawal or a failed re-placement can be reported —
    // and a publication whose regions went stale must not read as an
    // unqualified success.
    onSettled: (data, error) => {
      // The object's own caches, not only this queue: a publication changes the
      // fields, the points, the works and the counts every other surface reads,
      // and the card the curator just followed through to ("Look at the object")
      // shares its cache key with Discover and `CurationDialog`. Without this a
      // publish that succeeded is followed by the pre-publish snapshot for as
      // long as the global 60s `staleTime` lasts. Runs on failure too, for the
      // reason the queue's own refetch does: a refusal usually means the server
      // has already moved and this page is the stale one.
      invalidateExperiences(queryClient, { experienceId: group.id });
      onDone(error ? messageFor(item, error) : publishOutcomeFor(item, data));
    },
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        {/* A held half names its run in the summary above its table; the line here is
            for the cards that have no table — an arrival, or contents alone. */}
        {!held && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
            {runNote(group)}
          </Typography>
        )}

        <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mb: 2 }}>
          {arrival && (
            <GatedRow label="object">
              <Typography variant="body2">
                Nobody has passed this yet, so readers see nothing at its address. The whole object
                is the proposal — there is no earlier version to compare it against.
              </Typography>
            </GatedRow>
          )}

          {/* A card an earlier run filed with only the catalogue's own labels held —
              tags, which are no longer a question and no longer a row — would
              otherwise read "proposes nothing" over an empty table while its button
              wrote them. None on this database today; the shape is real, and it
              clears at the category's next run. */}
          {proposed.length > 0 && rows.length === 0 && (
            <GatedRow label="fields">
              <Typography variant="body2">
                {held?.sync_log_id ? `Run ${held.sync_log_id}` : 'An earlier run'} proposed only the
                catalogue’s own labels, which nothing readers see. Publishing writes them and asks
                nothing of you.
              </Typography>
            </GatedRow>
          )}

          {(rows.length > 0 || partRows.length > 0) && (
            <GatedRow label="fields">
              {/* What the run proposes, counted by kind, before a single row: the first
                  thing a curator needs to know is whether a value readers see is being
                  replaced or a fact is appearing where there was none, and on this
                  catalogue the second is the whole batch (#570). The parts' rows count
                  with the object's: one card, one decision. */}
              <ProposalSummary
                lead={held?.sync_log_id ? `Run ${held.sync_log_id} proposes` : 'An earlier run proposes'}
                rows={[...rows, ...partRows]}
              />
              {/* The same table the conflict card draws, because it is the same
                  decision: two versions of one fact and a person choosing between them.
                  The column headings differ and are the caller's to give — here the left
                  side is what readers are looking at right now, and no curator wrote it.
                  A part's group follows the object's, headed by the part's name and a
                  way to open it. */}
              <FactTable
                groups={[{ subject: { kind: 'object', label: item.name }, rows }, ...parts]}
                labels={{ before: 'readers see', after: 'the run proposes' }}
                context={context}
              />
              {/* Said here, where a curator is looking at wording they may not
                  want, because it is the one way to take the rest and refuse
                  this: publishing re-reads the claims under its own write lock
                  and skips any field the curator has since claimed
                  (`publishHeldFields.ts`), reporting it back as left alone.
                  Without naming the order nobody would find it. */}
              <Typography variant="caption" color="text.secondary">
                Don’t want one of these? Edit it yourself first — editing claims the field — and then
                publish: a field you claim is left as you wrote it, and everything else still lands.
              </Typography>
            </GatedRow>
          )}

          {points > 0 && (
            <GatedRow label="points">
              <Typography variant="body2">
                {plural(points, 'new point')} waiting — readers are shown the rest of this object
                without them.
              </Typography>
              <ContentsList
                total={points}
                shown={contents?.pending_points?.length ?? 0}
                noun="point"
                items={(contents?.pending_points ?? []).map(point => ({
                  id: point.id,
                  primary: point.name ?? point.externalRef ?? 'Unnamed point',
                  secondary: point.latitude != null && point.longitude != null
                    ? `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`
                    : null,
                }))}
              />
            </GatedRow>
          )}

          {works > 0 && (
            <GatedRow label="works">
              <Typography variant="body2">
                {plural(works, 'new work')} waiting — the museum itself is on show already.
              </Typography>
              <ContentsList
                total={works}
                shown={contents?.pending_works?.length ?? 0}
                noun="work"
                items={(contents?.pending_works ?? []).map(work => ({
                  id: work.id,
                  primary: work.name ?? 'Untitled',
                  secondary: [work.artist, work.year].filter(Boolean).join(', ') || null,
                }))}
              />
            </GatedRow>
          )}
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            disabled={publish.isPending}
            onClick={() => publish.mutate(undefined)}
          >
            {publishLabel(group)}
          </Button>
          {/* Only where both halves are open, because that is the only case in
              which the one button above does two things at once. The card of a
              museum holding twelve unread paintings and a proposed label used to
              force those together: answering the label released the paintings,
              so a curator who doubted one sentence held back twelve works
              (#524). */}
          {held && contents && (
            <Button
              variant="text"
              disabled={publish.isPending}
              onClick={() => publish.mutate({ fieldsOnly: true, expectedSyncLogId: held.sync_log_id })}
            >
              Publish the change only
            </Button>
          )}
          <Button variant="text" onClick={() => setShowObject(v => !v)}>
            {showObject ? 'Hide the object' : 'Look at the object'}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
          {holdingNote(group)}
        </Typography>

        {showObject && <ObjectPreview experienceId={group.id} />}
        <PartPreviewDialog part={openPart} onClose={() => setOpenPart(null)} />
      </CardContent>
    </Card>
  );
}

/**
 * The body `POST /:id/publish` gets for this group — one shape per case a
 * card can be in.
 *
 * A held proposal has a pointer to be stale against, so it names the run —
 * the only case that does — and its object publish also releases any
 * contents alongside it. A card with no held half but with contents open
 * sends `contentsOnly: true`: naming nothing at all would be an object
 * publish, which sets `curation_state = 'verified'` — a false claim that a
 * person read the museum when only its unread points and works were ever
 * looked at (ADR-0025 § 4.4), and a 409 waiting to happen the moment the row
 * also carries a claim's own pointer, since the endpoint then expects
 * `expectedSyncLogId`. An arrival has neither a held half nor a published
 * object underneath it, so `{}` — the object publish — is the one case it is
 * right for: there is no earlier verified state to misreport.
 *
 * The fourth shape, `fieldsOnly`, is not built here: it is not what a card *is*,
 * it is a second thing a curator can ask of a card that is both — so the button
 * that offers it builds it, and only where both halves are open.
 */
function publishBodyFor({ held, contents }: GatedGroup): PublishRequest {
  if (held) return { expectedSyncLogId: held.sync_log_id };
  if (contents) return { contentsOnly: true };
  return {};
}

/**
 * Which run put this in front of the curator, for the cards that have no table.
 *
 * An arrival's run is the one that first saw the row, and nothing is checked
 * against it — so the caption names it as first sight rather than as a proposal
 * — and a card that is only unread contents names no run at all, because none of
 * its rows carries one. A held card's run is the pointer the publication is
 * checked against, and the summary above its table names it (#570).
 */
function runNote({ arrival }: GatedGroup): string {
  if (arrival?.sync_log_id) return `First seen by run ${arrival.sync_log_id}`;
  return 'Arrived under this object';
}

/**
 * The rows behind a count, and the truth about how many of them there are.
 *
 * A count alone is what #524 is about — "12 new works waiting, counted rather than
 * listed" asks a curator to decide about twelve things they cannot see. A list
 * alone would be worse on the other end: the catalogue's largest serial nomination
 * holds 758 points, and a card is not a place to read 758 of anything.
 *
 * So the server caps the list and keeps the count whole, and this says which is
 * which. A cap that went unsaid would read as "these are all of them", which is
 * exactly the silent truncation that makes a queue untrustworthy.
 */
function ContentsList({ items, total, shown, noun }: {
  items: Array<{ id: number; primary: string; secondary: string | null }>;
  total: number;
  shown: number;
  noun: string;
}) {
  if (items.length === 0) return null;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }} spacing={0.25}>
        {items.map(item => (
          <Typography key={item.id} component="li" variant="caption" color="text.secondary">
            {item.primary}
            {item.secondary && <span> — {item.secondary}</span>}
          </Typography>
        ))}
      </Stack>
      {shown < total && (
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          {`showing ${shown} of ${total} ${noun}s`}
        </Typography>
      )}
    </Box>
  );
}

/** A label and what it is about, per § 4.2: grouped by container, listed by row. */
function GatedRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={2} alignItems="flex-start">
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 56, pt: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

/**
 * What the one button will actually do, said on the button.
 *
 * One button rather than one per row, because publishing an object is one act at
 * the endpoint: naming no contents applies the held fields, marks the row read
 * *and* releases every unread point and work under it.
 *
 * The ids a per-row publish needs are here now — the queue lists them beside each
 * count — and `POST /:id/publish` has always accepted `locationIds`/`treasureIds`.
 * The narrower act has its own button now — `fieldsOnly`, offered only where both
 * halves are open, since that is the only case in which this one does two things
 * at once. What is still missing of #524 is per-row publishing: the ids are here
 * beside each count and the endpoint has always accepted them, but nothing on the
 * card lets a curator choose among them, so a third button would promise a
 * precision the screen cannot express.
 */
function publishLabel(group: GatedGroup): string {
  if (group.arrival) return 'Publish — readers may see it';
  if (group.held && group.contents) return 'Publish the change and what arrived with it';
  if (group.held) return 'Publish the change';
  return 'Publish what has arrived';
}

/** What doing nothing means here — the answer that needs no call. */
function holdingNote(group: GatedGroup): string {
  if (group.arrival) return 'Until you publish it, nobody but a curator can see this at all.';
  if (group.held) {
    return 'Readers keep the version they can see until you publish, and the run will go on '
      + 'proposing this one. A field you have already claimed is a different question and keeps '
      + 'its own card — publishing leaves your wording alone.';
  }
  return 'The object itself is already visible; publishing releases only what has arrived under it.';
}
