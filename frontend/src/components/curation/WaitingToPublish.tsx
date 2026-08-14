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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchExperience,
  publishExperience,
  type PublishResult,
  type ReviewQueueItem,
} from '../../api/experiences';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { plural } from '../../utils/plural';
import { worldViewList } from '../../utils/worldViewList';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { ItemHeader, messageFor } from './queueCard';
import { FieldDiff } from './FieldDiff';
import { fieldLabel } from './fieldLabel';

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
 * The section — one heading, one sentence, one card per experience.
 *
 * The page's existing idiom (`ReviewQueue.tsx`) is a section per kind, each
 * teaching the curator what that decision means. These three teach the same
 * thing, so splitting them into three would repeat the sentence and split one
 * museum's card in two.
 */
export function WaitingToPublish({ groups, countLabel, pager, onDone }: {
  groups: GatedGroup[];
  countLabel: (n: number) => string;
  /**
   * The paging control, built by the page because the offsets live there.
   *
   * One control for three kinds, and here that is right rather than a compromise: the
   * section groups them by experience, so a curator reading a card cannot tell which kind
   * a row came from and would have nothing to do with three separate buttons.
   */
  pager?: React.ReactNode;
  onDone: (message?: string) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <>
      {/* The count is of experiences, not of rows, which is the number a curator
          is about to work through. It is the one heading whose "first N" can
          understate the page: three kinds page independently, so 25 held plus 25
          contents on different objects group to 50 and read as a total. The
          paging control is what carries the truth there — it appears whenever any
          kind filled its page — and inflating this number to match would name a
          backlog nobody can point at. */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
        Waiting to be published ({countLabel(groups.length)})
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        These came from a source that is held back until a person looks, so none of it has reached a
        visitor: an object nobody has passed yet, a change kept off a page readers can already see,
        or newly-arrived points and works underneath a row that is visible. Publishing is what lets
        any of it out, and nothing else does.
      </Typography>
      <Stack spacing={2}>
        {groups.map(group => (
          <GatedCard key={group.id} group={group} onDone={onDone} />
        ))}
      </Stack>
      {pager}
    </>
  );
}

/**
 * One experience's card: what is open about it, and the button that answers.
 *
 * Follows `MissingCard`'s idiom, `onSettled` included — the refetch runs whether
 * the call succeeded or not, because a failure usually means the server has
 * already answered and this page is the stale one, and a card left standing
 * would let every further click repeat the same refusal.
 */
function GatedCard({ group, onDone }: { group: GatedGroup; onDone: (message?: string) => void }) {
  const { arrival, held, contents } = group;
  const item = arrival ?? held ?? contents!;
  const queryClient = useQueryClient();
  const [showObject, setShowObject] = useState(false);
  const proposed = held?.proposed ?? [];
  const points = count(contents?.pending_locations);
  const works = count(contents?.pending_treasures);

  const publish = useMutation({
    mutationFn: () => publishExperience(group.id, publishBodyFor(group)),
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
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          {runNote(group)}
        </Typography>

        <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ mb: 2 }}>
          {arrival && (
            <GatedRow label="object">
              <Typography variant="body2">
                Nobody has passed this yet, so readers see nothing at its address. The whole object
                is the proposal — there is no earlier version to compare it against.
              </Typography>
            </GatedRow>
          )}

          {proposed.length > 0 && (
            <GatedRow label="fields">
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {plural(proposed.length, 'field')} held — {proposed.map(f => fieldLabel(f.field)).join(', ')}
              </Typography>
              {/* The same comparison the conflict card makes, because it is the same
                  decision: two versions of one text and a person choosing between them.
                  The labels differ and are the caller's to give — here the left side is
                  what readers are looking at right now, and no curator wrote it. */}
              {proposed.map(field => (
                <Box key={field.field} sx={{ mb: 0.5 }}>
                  <FieldDiff
                    field={field}
                    labels={{ before: 'readers see', after: 'the run proposed' }}
                  />
                </Box>
              ))}
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
            </GatedRow>
          )}

          {works > 0 && (
            <GatedRow label="works">
              <Typography variant="body2">
                {plural(works, 'new work')} waiting, counted rather than listed.
              </Typography>
            </GatedRow>
          )}
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            disabled={publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publishLabel(group)}
          </Button>
          <Button variant="text" onClick={() => setShowObject(v => !v)}>
            {showObject ? 'Hide the object' : 'Look at the object'}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
          {holdingNote(group)}
        </Typography>

        {showObject && <ObjectPreview experienceId={group.id} />}
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
 */
function publishBodyFor(
  { held, contents }: GatedGroup,
): { expectedSyncLogId?: number } | { contentsOnly: true } | Record<string, never> {
  if (held) return { expectedSyncLogId: held.sync_log_id };
  if (contents) return { contentsOnly: true };
  return {};
}

/**
 * Which run put this in front of the curator.
 *
 * Two different facts wearing one column name. A held card's run is the pointer
 * the publication is checked against; an arrival's is the run that first saw the
 * row, and nothing is checked against it — so the caption names it as first
 * sight rather than as a proposal, and a card that is only unread contents names
 * no run at all, because none of its rows carries one.
 */
function runNote({ arrival, held }: GatedGroup): string {
  // `sync_log_id` is optional on the type, and a held item should always
  // carry one — but printing the literal word "undefined" for a row that
  // somehow lacks it is worse than naming no run at all.
  if (held) return held.sync_log_id === undefined ? 'Proposed by an earlier run' : `Proposed by run ${held.sync_log_id}`;
  if (arrival?.sync_log_id) return `First seen by run ${arrival.sync_log_id}`;
  return 'Arrived under this object';
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
 * *and* releases every unread point and work under it. Offering a separate
 * "publish the points" would need their ids, which this queue counts rather than
 * lists — so a second button would either send the same request under a
 * different promise or 409.
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

/**
 * The object as a curator may see it, which is the only reason it can be seen.
 *
 * An arrival is absent from every list, count and map — the gate is absolute
 * there — and a by-id read is the one place it answers, relaxed for a curator
 * exactly so this card can be followed through to the thing it is asking about.
 * Without it the card names an object and offers no way to judge it, which is
 * the dead end this whole section exists to remove.
 */
function ObjectPreview({ experienceId }: { experienceId: number }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['experience', experienceId],
    queryFn: () => fetchExperience(experienceId),
  });

  if (isLoading) return <LoadingSpinner size={20} padding={2} />;
  if (isError || !data) {
    return (
      <Typography variant="body2" color="error" sx={{ mt: 2 }}>
        Could not open the object{error instanceof Error ? `: ${error.message}` : '.'}
      </Typography>
    );
  }

  const source = extractImageUrl(data.image_url);
  const image = source ? toThumbnailUrl(source, 250) : null;
  return (
    <Stack direction="row" spacing={2} sx={{ mt: 2 }} alignItems="flex-start">
      {image && (
        <Box
          component="img"
          src={image}
          alt={data.name}
          sx={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 1 }}
        />
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          {data.description || data.short_description || 'No description on the object.'}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {data.latitude.toFixed(4)}, {data.longitude.toFixed(4)}
          {data.country_names?.length > 0 ? ` — ${data.country_names.join(', ')}` : ''}
        </Typography>
        {/* `fetchExperience` (`GET /api/experiences/:id`) carries no
            `location_count` at all — that column exists only on the region
            list's own query (`buildRegionQueries`) — so a count here would
            read zero regardless of the object's real contents. A true
            sentence beats a number that is always wrong; #524 tracks the read
            that would list this object's points and works properly. */}
        <Typography variant="caption" color="text.secondary" display="block">
          Its points and works are not listed on this preview.
        </Typography>
      </Box>
    </Stack>
  );
}

/**
 * What the publication did, in one sentence, plus a second when it went wrong
 * halfway.
 *
 * `withdrawalsReleased` and `placementFailed` are the two the response carries
 * that nothing would otherwise say: a point the source replaced stops being
 * shown at this moment and nowhere else records when, and a publication that
 * landed while re-placing the object failed is a success with stale regions —
 * which must not read as an unqualified one.
 */
export function publishOutcomeFor(
  item: { name: string }, data?: PublishResult,
): string | undefined {
  if (!data) return undefined;
  const parts: string[] = [];
  // Field names in the reader's words here too — this line answers the same card whose
  // rows are labelled through `fieldLabel`.
  if (data.appliedFields.length > 0) {
    parts.push(`${data.appliedFields.map(fieldLabel).join(', ')} applied`);
  }
  if (data.claimedFieldsSkipped.length > 0) {
    parts.push(`${data.claimedFieldsSkipped.map(fieldLabel).join(', ')} left as you wrote them`);
  }
  const released: string[] = [];
  if (data.locationsPublished > 0) released.push(plural(data.locationsPublished, 'point'));
  // The same works counted from two axes — the link says a work has been passed
  // *here*, the work says it has been passed at all — so this is one number for
  // a curator, not two.
  const worksPublished = Math.max(data.treasureLinksPublished, data.treasuresPublished);
  if (worksPublished > 0) released.push(plural(worksPublished, 'work'));
  if (released.length > 0) parts.push(`${released.join(' and ')} now visible`);
  if (data.withdrawalsReleased > 0) {
    parts.push(`${plural(data.withdrawalsReleased, 'replaced point')} no longer shown`);
  }
  if (parts.length === 0) parts.push('published');

  const outcome = `${item.name}: ${parts.join('; ')}.`;
  if (!data.placementFailed) return outcome;
  // Named, and addressed to someone who cannot fix it. Re-assigning regions is
  // admin-only end to end, and this page's ordinary reader is a region- or
  // category-scoped curator — so the actionable step is to hand an admin the
  // object and the world views, which means the sentence has to contain them.
  // Ids come along with the names because that is what an admin works from.
  // Bent by what the same sentence just printed, and keyed on a *named* world view
  // rather than on the array's length: `worldViewList` joins several — one failure per
  // world view is its ordinary shape — and the two shapes that name none are `[]` and
  // the single `{id: null}` the server sends when listing the world views is itself what
  // failed, which renders "every world view — they could not even be listed". Counting
  // that one as length 1 put "that world view" under a plural sentence, in the line
  // written to be handed to an admin word for word.
  const failed = data.placementFailedWorldViews;
  const failedOne = failed?.length === 1 && failed[0].id !== null;
  return `${outcome} Its regions were not recomputed in ${worldViewList(data.placementFailedWorldViews)} — only an admin can `
    + `run a re-assignment, so tell one this object and ${failedOne ? 'that world view' : 'those world views'}; `
    + 'until then it is placed by the point it no longer has.';
}

