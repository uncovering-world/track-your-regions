/**
 * One kind's question about a place a gated source is holding, and its answers.
 *
 * `WaitingToPublish.tsx` says what the three gated questions are and why they
 * share a card; this file is the body of that card for one membership. A place
 * in one kind has one section, drawn exactly as the card always was; a place in
 * two kinds that both ask (#1264) has a section per kind under one header,
 * because every answer here is written under that kind's membership and no
 * other's.
 */

import { useState, type ReactNode } from 'react';
import {
  Box, Typography, Button, Stack, Divider, Link, Collapse,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  declineHeld,
  publishExperience,
  refuseArrival,
  refuseContents,
  type PublishRequest,
  type RefuseContentsBody,
} from '../../api/curation';
import { namedMembership } from '../../utils/namedMembership';
import type { HeldPart, ReviewQueueItem } from '../../api/reviewQueue';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { plural } from '../../utils/plural';
import { worldViewList } from '../../utils/worldViewList';
import { ANSWER_WORDS } from './selection/answerWords';
import { GatedRow, messageFor } from './queueCard';
import { FactTable, ProposalSummary } from './FactTable';
import { partGroups, rowsFor } from './factRows';
import { HeldAnswer, type HeldSelection } from './HeldAnswer';
import { heldRefusalOutcomeFor, publishOutcomeFor } from './publishOutcome';
import { PartPreviewDialog } from './PartPreviewDialog';
import { ArrivedTable, RowAnswer } from './ArrivedTable';
import { movedPointGroups } from './movedPointGroups';
import { sectionKind, type GatedGroup } from './gatedGroup';

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
 * One kind's question about a place: what is open about it, and the buttons
 * that answer it. A place in two kinds can be asked by both (#1264), and each
 * answer is that kind's membership's alone, so each kind gets its own section.
 *
 * Follows `MissingCard`'s idiom, `onSettled` included — the refetch runs whether
 * the call succeeded or not, because a failure usually means the server has
 * already answered and this page is the stale one, and a card left standing
 * would let every further click repeat the same refusal.
 */
export function GatedSection({ group, heading, objectButton, onDone }: {
  group: GatedGroup;
  /** "<Kind> asks", on a card with more than one section; none on a card with one. */
  heading?: string;
  /** "Look at the object" — one per card, drawn in its last section's row of buttons. */
  objectButton?: ReactNode;
  onDone: (message?: string) => void;
}) {
  const { arrival, held, contents } = group;
  const item = arrival ?? held ?? contents!;
  // Trimmed before it is asked about, as `ObjectPreview` trims the same note:
  // a note of blanks is a note nobody wrote, and drawing "The run asks:" over
  // nothing tells a curator a question was asked and then withholds it.
  const askedNote = item.admission_note?.trim();
  const queryClient = useQueryClient();
  // Which part is open. Nothing a curator opened here outlives the section:
  // `GatedCard` keys each section on its place and membership, so moving to
  // the next waiting row remounts it, and a part of one object is never
  // corrected under the next object's name or id.
  const [openPart, setOpenPart] = useState<HeldPart | null>(null);

  const proposed = held?.proposed ?? [];
  // The credit beside the danger fields: whose photograph readers see today, for a
  // picture row on a card that proposes a picture and no credit beside it.
  const context = {
    proposed, inDanger: item.in_danger, dangerSince: item.danger_since, imageCredit: item.image_credit ?? null,
  };
  const rows = rowsFor(proposed, context);
  // The held fields of the object's parts, one group per part under the object's
  // own (ADR-0037): a change inside a part is a change on the object's card, not
  // a separate queue. The summary counts every row, since a curator deciding
  // whether to publish is deciding about all of it.
  const parts = partGroups(
    held?.proposed_parts ?? [], context, { offeredLocations: item.offered_locations }, setOpenPart,
  );
  // A point the source moved is a change to what readers see, asked beside the
  // parts' held fields; the point that is the object's own coordinate moving is
  // the coordinates row itself and gets no group (`movedPointGroups.ts`).
  const moved = movedPointGroups(contents, item.name);
  const partRows = [...parts, ...moved].flatMap(group => group.rows);
  const works = count(contents?.pending_treasures);
  const points = count(contents?.pending_locations) - count(contents?.pending_moved_locations);
  const [showHow, setShowHow] = useState(false);

  const publish = useMutation({
    // The membership the section is about (#1264): a held field's answer is
    // the held proposal's, anything else the arrival's where there is one, and
    // unread contents the membership whose run placed them (#1290).
    mutationFn: (body?: PublishRequest) => publishExperience(group.id, {
      ...(body ?? publishBodyFor(group)),
      ...namedMembership(body?.heldFields !== undefined || body?.heldParts !== undefined
        ? held?.membership_id
        : (arrival ?? held ?? contents)?.membership_id),
    }),
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

  // The other answer to one row (#722), and its own mutation because it is its
  // own act: publishing writes columns, releases contents and can re-place the
  // object, while refusing writes nothing to the row at all and closes the
  // question for that value alone.
  const refuse = useMutation({
    mutationFn: (selection: HeldSelection) =>
      declineHeld(group.id, { ...selection, ...namedMembership(held?.membership_id) }, held?.sync_log_id ?? 0),
    onSettled: (data, error) => {
      // Refusing writes nothing, so nothing about the object needs re-reading —
      // the one gap it opens is a later publish's to make, not this call's (the
      // caption says so) — but the queue's own counts do, and they ride on the same
      // invalidation the publish path uses rather than a second, narrower one
      // that would drift from it.
      invalidateExperiences(queryClient, { experienceId: group.id });
      onDone(error ? messageFor(item, error) : heldRefusalOutcomeFor(item, data));
    },
  });
  // Either answer in flight disables *every* button on the card, the object-level
  // ones included. Both endpoints take OBJECT_LOCK, and an object publish with no
  // selection writes every row still open: start refusing one field, click
  // "Publish everything on this card" before it lands, and if the publish wins the lock it
  // writes the value being refused and clears the pointer — the refusal then finds
  // no proposal, answers 409, and the value is on the site with no card left to
  // answer. Guarding only the per-row buttons would leave the two that publish the
  // most as the way to lose the answer being given.
  // An arrival kept out (#852, ADR-0053) — written the way a rule's refusal
  // is, so the kept-out list is where it comes back from. Its own mutation for
  // the reason the held refusal is: it writes the membership and nothing else.
  const keepOut = useMutation({
    mutationFn: () => refuseArrival(group.id, namedMembership(arrival?.membership_id)),
    onSettled: (_data, error) => {
      invalidateExperiences(queryClient, { experienceId: group.id });
      onDone(error ? messageFor(item, error) : keptOutOutcomeFor(item, true, {}));
    },
  });
  // A no to unread rows — one work, one point, or the arrived section's all —
  // which stay hidden and stop being asked about. Refusing a point re-places
  // the object, since the point counts toward no region now; a moved point's
  // pin stays where readers see it (ADR-0083).
  const turnDown = useMutation({
    // Through the section's membership (#1290): the no reaches the rows this
    // kind placed and no other section's.
    mutationFn: (body: RefuseContentsBody) =>
      refuseContents(group.id, { ...body, ...namedMembership(contents?.membership_id) }),
    onSettled: (data, error) => {
      invalidateExperiences(queryClient, { experienceId: group.id });
      onDone(error ? messageFor(item, error) : keptOutOutcomeFor(item, false, data));
    },
  });
  const answering = publish.isPending || refuse.isPending || keepOut.isPending || turnDown.isPending;

  return (
    <Box sx={heading ? { border: 1, borderColor: 'divider', borderRadius: 1, p: 2 } : undefined}>
      {heading && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{heading}</Typography>
      )}
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
            <Typography variant="body2">{arrivalNote(arrival)}</Typography>
          </GatedRow>
        )}

        {/* A card an earlier run filed with only the catalogue's own labels held —
            tags, which are no longer a question and no longer a row — would
            otherwise read "proposes nothing" over an empty table while its button
            wrote them. None on this database today; the shape is real, and it
            clears at the kind's next run. */}
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
          <GatedRow label="changes">
            {/* What the run proposes, counted by kind, before a single row: the first
                thing a curator needs to know is whether a value readers see is being
                replaced or a fact is appearing where there was none, and on this
                catalogue the second is the whole batch (#570). The parts' rows count
                with the object's: one card, one decision. */}
            <ProposalSummary
              lead={summaryLead(held)}
              rows={[...rows, ...partRows]}
            />
            {/* The same table the conflict card draws, because it is the same
                decision: two versions of one fact and a person choosing between them.
                The column headings differ and are the caller's to give — here the left
                side is what readers are looking at right now, and no curator wrote it.
                A part's group follows the object's, headed by the part's name and a
                way to open it. */}
            <FactTable
              groups={[{ subject: { kind: 'object', label: item.name }, rows }, ...parts, ...moved]}
              labels={{ before: 'readers see', after: 'the run proposes' }}
              // One fact at a time (#722), because a run improves and damages in
              // the same breath: run 68 wants to drop "(Phase II)" from Getbol's
              // name and to rewrite its description for the 2026 extension, and
              // until now those were one button. The subject comes with the field
              // because a field name is not an identity across groups — two works
              // in one museum both have an attribution row.
              answer={(field, _fieldRows, subject) => (subject.movedPointId !== undefined ? (
                // A moved point is answered by its id: published, it replaces the
                // pin readers see; turned down, it stays hidden and readers keep
                // the pin it would have replaced (ADR-0083).
                <RowAnswer
                  busy={answering}
                  onPublish={() => publish.mutate({ locationIds: [subject.movedPointId!] })}
                  onRefuse={() => turnDown.mutate({ locationIds: [subject.movedPointId!] })}
                />
              ) : (
                <HeldAnswer
                  subject={subject}
                  field={field}
                  busy={answering}
                  onPublish={selection => publish.mutate({
                    heldFields: selection.fields,
                    heldParts: selection.parts,
                    expectedSyncLogId: held?.sync_log_id ?? 0,
                  })}
                  onRefuse={selection => refuse.mutate(selection)}
                />
              ))}
            />
            {/* What the two answers differ in, and the difference is not
                symmetric — the same sentence the conflict card ends on, for the
                same reason. Folded: it is read once, and five lines under every
                table were most of what a curator scrolled past. */}
            <Link component="button" type="button" variant="caption" underline="hover"
              onClick={() => setShowHow(v => !v)} aria-expanded={showHow}>
              How answers work
            </Link>
            <Collapse in={showHow}>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, maxWidth: '80ch' }}>
                Publishing one of these leaves the rest waiting. A picture is answered with its
                credit, shown under it on each side. “Not this” settles the question — the run has to
                propose something different to ask again — and changes nothing readers see: a moved
                point turned down leaves its pin where it was. On
                a card raised before facts were asked one at a time, one combination still reaches
                readers: say no to source data and then publish a new picture, and the picture goes
                out with nobody credited, since the refused credit may not be written and the stored
                one names a photograph nobody will see. A field you have edited yourself is a
                different question and keeps your wording either way.
              </Typography>
            </Collapse>
          </GatedRow>
        )}
        {(points > 0 || works > 0) && (
          <GatedRow label="arrived">
            <ArrivedTable
              group={group}
              item={item}
              contents={contents}
              works={works}
              points={points}
              busy={answering}
              onPublish={body => publish.mutate(body)}
              onRefuse={body => turnDown.mutate(body)}
              onDone={onDone}
            />
          </GatedRow>
        )}
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="outlined"
          disabled={answering}
          onClick={() => publish.mutate(undefined)}
        >
          {publishLabel(group, heading !== undefined)}
        </Button>
        {/* The arrival's no (#852): kept out, the way a rule's refusal is.
            Everything else on a card is answered on its own row — a held field,
            a moved point, an arrived work — so a card-level no would only say
            one of those twice. */}
        {arrival && (
          <Button
            variant="outlined"
            color="warning"
            disabled={answering}
            onClick={() => keepOut.mutate()}
          >
            {ANSWER_WORDS.arrival.reject}
          </Button>
        )}
        {objectButton}
      </Stack>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
        {holdingNote(group)}
      </Typography>

      {/* The run's own question, beside the sentence saying what is being held
          — on the card and not only on the preview behind "Look at the object".
          A rule that cannot settle a row writes down what it saw and holds it
          (ADR-0058), and the batch answer of #852 can dispose of the row
          without the object ever being opened: a question kept behind a toggle
          is one a curator can answer without having been shown it. */}
      {askedNote && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          <Box component="span" sx={{ fontWeight: 600 }}>The run asks:</Box> {askedNote}
        </Typography>
      )}

      <PartPreviewDialog
        part={openPart}
        onClose={() => setOpenPart(null)}
        object={{ id: group.id, name: item.name }}
        onDone={onDone}
      />
    </Box>
  );
}

/** Who the changes table's rows come from: a run's held proposal, or the source's moves alone. */
function summaryLead(held: ReviewQueueItem | undefined): string {
  if (!held) return 'The source moved';
  return held.sync_log_id ? `Run ${held.sync_log_id} proposes` : 'An earlier run proposes';
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
function publishBodyFor({ held, contents }: GatedGroup): PublishRequest {
  // A held card always names its run; the card type is shared with the arrival,
  // whose run can be null, so the null is turned back into "not sent".
  if (held) return { expectedSyncLogId: held.sync_log_id ?? undefined };
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
 * What the one button will actually do, said on the button.
 *
 * One card-level button, because publishing an object is one act at the
 * endpoint: naming no contents applies the held fields, marks the row read
 * *and* releases every unread point and work under it. Everything narrower is
 * a row's own answer (#524), so the button says it takes everything.
 */
function publishLabel(group: GatedGroup, sectioned: boolean): string {
  if (group.arrival && seenIn(group.arrival).length > 0) return `Publish — list it under ${group.arrival.kind_name}`;
  if (group.arrival) return 'Publish — readers may see it';
  // On a card two kinds ask on, the button reaches its own section alone.
  if (sectioned) return `Publish everything ${sectionKind(group)} asks`;
  return 'Publish everything on this card';
}

/**
 * The line after a no: what is now kept out, and where it comes back from. A
 * kept-out arrival is one object; turned-down contents are counted, since the
 * card counted them.
 */
function keptOutOutcomeFor(
  item: ReviewQueueItem,
  arrival: boolean,
  data: Partial<Awaited<ReturnType<typeof refuseContents>>> | undefined,
): string {
  const { name } = item;
  if (arrival && seenIn(item).length > 0) {
    return `${name} kept out of ${item.kind_name}. Readers still see it under ${kindList(seenIn(item))}, and it `
      + 'comes back from the kept-out list at the foot of this page.';
  }
  if (arrival) {
    return `${name} kept out. It stays hidden, and comes back from the kept-out list at the `
      + 'foot of this page.';
  }
  const points = data?.locationsRefused ?? 0;
  const works = data?.treasureLinksRefused ?? 0;
  const parts = [
    points > 0 ? plural(points, 'unread point') : null,
    works > 0 ? plural(works, 'unread work') : null,
  ].filter(Boolean).join(' and ');
  // The re-placement a refused point calls for — it counts toward no region
  // now — where it failed: named for an admin, through the same helper every
  // other placement line uses.
  const stale = data?.placementFailed
    ? ` ${name} could not be re-placed into ${worldViewList(data.placementFailedWorldViews)} — tell an admin.`
    : '';
  // Where they come back from, said in the line that put them there (#859): the
  // list is collapsed at the foot of this page and nothing else shows them.
  return `${parts || 'Nothing'} under ${name} turned down. They stay hidden and are no longer `
    + `asked about — and come back from the turned-down list at the foot of this page.${stale}`;
}

/**
 * The kinds readers already see a place in through another membership — the
 * Capitoline Museums as an art museum, while an Archaeology run's arrival waits
 * (#1264). Empty where the arrival is the whole place.
 */
function seenIn(arrival: ReviewQueueItem): string[] {
  return arrival.seen_in ?? [];
}

function kindList(kinds: string[]): string {
  return kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0];
}

/**
 * What an arrival is, said of what readers see: nothing at all, or the place in
 * its other kinds and not yet in this one — an arrival under a second kind is
 * not a place nobody can see, and a card saying so would misdescribe it.
 */
function arrivalNote(arrival: ReviewQueueItem): string {
  const seen = seenIn(arrival);
  if (seen.length === 0) {
    return 'Nobody has passed this yet, so readers see nothing at its address. The whole object is the '
      + 'proposal — there is no earlier version to compare it against.';
  }
  return `Readers already see this place under ${kindList(seen)}. Nobody has passed it under `
    + `${arrival.kind_name} yet, so it is in no ${arrival.kind_name} list or count until you publish it.`;
}

/** What doing nothing means here — the answer that needs no call. */
function holdingNote(group: GatedGroup): string {
  if (group.arrival && seenIn(group.arrival).length > 0) {
    return `Until you publish it, readers see it only under ${kindList(seenIn(group.arrival))}.`;
  }
  if (group.arrival) return 'Until you publish it, nobody but a curator can see this at all.';
  if (group.held) {
    return 'Readers keep the version they can see until you publish, and the run will go on '
      + 'proposing this one. A field you have already claimed is a different question and keeps '
      + 'its own card — publishing leaves your wording alone.';
  }
  return 'The object itself is already visible; publishing releases only what has arrived under it.';
}
