/**
 * The one question a curator is looking at, and everything it rests on.
 *
 * The cards are unchanged from when they were a stack — they were already the right size
 * for this; what changes is that exactly one is on screen. That is the point of the split:
 * the evidence a decision needs (both versions in full, the object, the works a rule
 * counted) is what made a scrollable stack unworkable, and it is exactly what a curator
 * wants when the question is the one in front of them.
 */

import { Alert, Box, Typography } from '@mui/material';
import type { QueueRow, RowKind } from './queueRows';
import { MissingCard, ConflictCard } from './ReviewQueue';
import { RefusedCard } from './RefusedCards';
import { PinQuestionCard } from './PinQuestionCard';
import { VisitQuestionCard } from './VisitQuestionCard';
import { ApproximatePointsCard } from './ApproximatePointsCard';
import { SourcesCard } from './SourcesCard';
import { ComponentItemsCard } from './ComponentItemsCard';
import { MergeProposalsCard } from './MergeProposalsCard';
import { KindMissingCard } from './KindMissingCard';
import { asksOfKinds } from './kindQuestions';
import { GatedCard } from './WaitingToPublish';
import { WithdrawnCard } from './WithdrawnPoints';

/**
 * What this kind of question means, above the card that answers it.
 *
 * These were section preambles when the page was one column, and they have to survive the
 * split — they are the only place the *class* of question is explained, and a curator
 * meeting their first refusal needs to know that the row is already hidden from readers
 * before they read a word of the rule. On the bench they are better placed than they were:
 * shown once, beside the decision, rather than once above nineteen of them.
 */
const KIND_NOTE: Record<RowKind, string> = {
  conflicts: 'Your version is the one visitors see. The source has been proposing something '
    + 'else, and will keep proposing it until you answer.',
  sources: 'Two sources that each describe this place — say UNESCO and Wikidata — disagree about '
    + 'what it is called, how it looks or where it stands. Visitors see one of the two; pick the one '
    + 'that serves them, fact by fact.',
  waiting: 'This came from a source held back until a person looks, so none of it has reached '
    + 'a visitor: an object nobody has passed yet, a change kept off a page readers can '
    + 'already see — or off one of the places or works it is made of — or newly-arrived '
    + 'points and works under a row that is visible. '
    + 'Publishing is what lets it out, and nothing else does.',
  refused: 'Every list here has a rule of ours for what belongs in it, and this failed it — so '
    + 'visitors have never seen it in that list. The source may well still list it. The question is not '
    + 'whether the object is interesting, but whether our rule was right about it.',
  missing: 'A run that finished without errors stopped finding this. That can mean the source '
    + 'delisted it, that it no longer exists, or that the source was simply wrong — and only '
    + 'the first two change anything.',
  withdrawn: 'The object is still listed; one or more of the places it is made of are not. '
    + 'Visitors stopped seeing them the moment the run noticed, so this asks what to record '
    + 'about each — not whether to hide it. Nothing was deleted: anyone who had been there '
    + 'keeps that.',
  'component-items': 'Some parts of this serial site have no Wikidata entry recording their UNESCO number, and '
    + 'the search found entries that stand beside them or say they are part of the site. A match by place and '
    + 'name is a guess until you say otherwise. Confirming one makes it the part’s entry — its picture and '
    + 'description follow — and your choice is kept through every run; turning one down keeps it from being '
    + 'offered again.',
  'merge-proposals': 'Another place stands within reach of this one under a name alike — the Statue of Liberty as a '
    + 'World Heritage site and as public art, Durham Cathedral beside the site "Durham Castle and Cathedral". '
    + 'Nothing is wrong on either card; the question is what a traveller stands in front of. One place folds the '
    + 'other into this one — one pin, both kinds, visits kept — and can be undone from the history. Two places '
    + 'keeps them apart for good. One part of the other records which is the part, and merges nothing.',
  'pin-question': 'A curator — perhaps you — answered whether this place belongs in this list and pinned the answer, '
    + 'so every run kept it as they left it. A run asks about it again: either it says something else — it turns the '
    + 'place down for a different reason, or its rule would now take in what you kept out — or an admin asked for every '
    + 'such answer to be looked at again after the rule changed, and the run still says what you answered over. Nothing '
    + 'has changed for visitors yet: keep your answer, or let the rule decide.',
  'visit-question': 'This list offers the place, but little says a visitor goes there: fewer than two of four '
    + 'witnesses — a travel guide, photographs taken there, Wikidata\'s heritage or visitor facts, the map — vouch for '
    + 'it, and Jev reads it as a place with nothing to see, not one place, or an object kept elsewhere. Eboracum is '
    + 'Roman York under the living city; the Venus of Tan-Tan is a stone in a museum. Visitors still see it: refuse it '
    + 'from the list, as suggested, or keep it, and it is not asked again.',
  'approximate-points': 'The World Heritage list places these components only roughly: to the whole minute, a cell '
    + 'of about two kilometres, or on a point another component shares. The Longmen Grottoes stand 10 km from theirs. '
    + 'Pick where each stands from the hints, place it by hand, or keep the list\'s point; readers see it until you do.',
  'approximate-unhinted': 'The World Heritage list places these components only roughly, and nothing else says where '
    + 'they stand: no map object carries their number, no Wikidata entry or namesake stands near. Keep the list\'s '
    + 'point where it serves a large area well enough, or place it by hand; a later search that finds a hint moves it '
    + 'to the cards that ask.',
};

/** The note above a kind whose source stopped listing a place other sources still list (#1264). */
const KIND_MISSING_NOTE = 'One of the sources that list this place stopped finding it, while the others still '
  + 'list it. So the question is not whether the place still stands — it is whether it is still of that kind.';

export function ReviewBench({ row, onDone }: {
  row: QueueRow | undefined;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  if (!row) {
    return (
      <Box sx={{ p: 4 }}>
        {/* Reachable for the one render between a row being answered away and the page
            choosing the next one — and only that, since the list always has a selection
            otherwise, and a row an answer only moved keeps its card (`ReviewPage`, #1779). No mention of keys: nothing in this branch binds one, and the
            keyboard is deliberately deferred to 1.0. */}
        <Typography color="text.secondary">
          Pick a question on the left.
        </Typography>
      </Box>
    );
  }

  // A kind whose source stopped listing a place others still list asks something
  // narrower than the place's own card, and its note must not offer what it does not.
  const note = row.kind === 'missing' && asksOfKinds(row.items) ? KIND_MISSING_NOTE : KIND_NOTE[row.kind];

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {note}
      </Typography>
      {row.kind === 'conflicts' && row.item && <ConflictCard item={row.item} onDone={onDone} />}
      {row.kind === 'sources' && row.item && <SourcesCard item={row.item} onDone={onDone} />}
      {row.kind === 'component-items' && row.item && <ComponentItemsCard item={row.item} onDone={onDone} />}
      {row.kind === 'merge-proposals' && row.item && <MergeProposalsCard item={row.item} onDone={onDone} />}
      {row.kind === 'refused' && row.items && <RefusedCard items={row.items} onDone={onDone} />}
      {row.kind === 'pin-question' && row.items && <PinQuestionCard items={row.items} onDone={onDone} />}
      {row.kind === 'visit-question' && row.items && <VisitQuestionCard items={row.items} onDone={onDone} />}
      {(row.kind === 'approximate-points' || row.kind === 'approximate-unhinted') && row.item && (
        <ApproximatePointsCard item={row.item} onDone={onDone} />
      )}
      {row.kind === 'missing' && row.items && asksOfKinds(row.items) && <KindMissingCard items={row.items} onDone={onDone} />}
      {row.kind === 'missing' && row.item && !asksOfKinds(row.items) && <MissingCard item={row.item} onDone={onDone} />}
      {row.kind === 'withdrawn' && row.item && <WithdrawnCard item={row.item} onDone={onDone} />}
      {row.kind === 'waiting' && row.sections && <GatedCard sections={row.sections} onDone={onDone} />}
      {/* A row whose payload is missing is a bug in the row builder rather than a state a
          curator can be in — but silence here would read as "nothing to decide", which is
          the one answer this screen must never give by accident. */}
      {!row.item && !row.sections && (
        <Alert severity="warning">
          This question could not be opened. Reload the page; if it persists, the queue and
          the screen disagree about what {row.name} is asking.
        </Alert>
      )}
    </Box>
  );
}
