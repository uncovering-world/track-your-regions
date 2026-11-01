/**
 * Two near places with similar names (#1249, ADR-0046 decisions 2 to 4): the
 * place the card is about and, beside it, each place the pass found within
 * reach under a name alike — the Statue of Liberty as a World Heritage site
 * and as public art, Durham Cathedral beside the site "Durham Castle and
 * Cathedral" — and the curator says of each pair what the two are.
 *
 * *One place* folds the other into this one, the lower id: one pin, both
 * kinds, visits kept, undone from the history like any merge. *Two places*
 * keeps them apart and the pair is never proposed again. *One part of the
 * other* records which is the part and merges nothing (decision 6, #823). A
 * pair that is *exact* — one and the same folded name within fifty metres —
 * is marked, and one button answers every such pair *one place* at once; a
 * pair merely alike is read and judged on its own. Nothing is written until
 * the curator saves.
 */

import { useState } from 'react';
import { Box, Button, Card, CardContent, Chip, Link, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  answerMergeProposals, suggestMergeProposals, type AnswerMergeProposalsBody, type MergeProposalsAnswered,
  type MergeProposalSuggestions,
} from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { distanceLabel } from '../../utils/moveDescription';
import { plural } from '../../utils/plural';
import { wikidataItemUrl } from '../../utils/wikidataLinks';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import type { MapPin } from '../shared/PointPreviewPins';
import { JEV_SURE } from './ComponentItemsCard';
import { ItemHeader, messageFor, partOfLead } from './queueCard';

type Pair = NonNullable<ReviewQueueItem['merge_pairs']>[number];
type Answer = AnswerMergeProposalsBody['answers'][number]['answer'];
/** The curator's answer to one pair, with which place is the part where that is the answer. */
interface PairAnswer { answer: Answer; partId?: number }
type Judgement = MergeProposalSuggestions['suggestions'][number];

/** What Jev makes of a pair, in the words the caption uses. */
const JUDGEMENT_WORDS: Record<Judgement['judgement'], string> = {
  one: 'one place',
  two: 'two places',
  part_of: 'one part of the other',
};

/**
 * Jev's confidence is the margin over its other options, so a low one is a
 * near coin toss rather than a weak yes: said as leaning, not as saying.
 */
function judgementWords(judgement: Judgement): string {
  const percent = `${Math.round(judgement.confidence * 100)} %`;
  return judgement.confidence < 0.5
    ? `Jev is unsure, leans ${JUDGEMENT_WORDS[judgement.judgement]} · ${percent}`
    : `Jev says ${JUDGEMENT_WORDS[judgement.judgement]} · ${percent}`;
}

/**
 * How alike the names are: the same, a share, or — for a pair found because
 * every word of one name stands in the other's (#1652) — the words that
 * matched (#2194), since a share of 17 % would read as a reason not to ask,
 * and the one word two names share is often a town's (Tallinn's Old Town
 * beside Freedom Square), which "one name within the other" would overstate.
 * Said of the places' names, not of the two shown: the rule reads every name
 * a place is known by, and the word may stand in a source's or a local name
 * the card does not print. A pair written before the words were recorded
 * says the rule's name.
 */
function similarityWords(pair: Pair): string {
  if (pair.nameSimilarity >= 1) return 'the same name';
  if (pair.foundBy === 'words') {
    const words = pair.matchedWords;
    if (!words || words.length === 0) return 'one name within the other';
    const quoted = words.map(word => `“${word}”`).join(', ');
    return words.length === 1 ? `one word in common: ${quoted}` : `the words ${quoted} stand in both places’ names`;
  }
  return `names ${Math.round(pair.nameSimilarity * 100)} % alike`;
}

/** The other place's picture with its credit under it — or the room it would take, so the rows line up. */
function OtherPicture({ pair }: { pair: Pair }) {
  const [failed, setFailed] = useState(false);
  const src = pair.otherImageUrl ? toThumbnailUrl(extractImageUrl(pair.otherImageUrl) ?? '', 120) : '';
  if (!src || failed) return <Box sx={{ width: 64, flexShrink: 0 }} />;
  return (
    <Box sx={{ width: 64, flexShrink: 0 }}>
      <Box component="img" src={src} alt="" loading="lazy" onError={() => setFailed(true)}
        sx={{ width: 64, height: 56, objectFit: 'cover', borderRadius: 0.5, display: 'block' }} />
      <ImageCreditLine credit={pair.otherImageCredit} />
    </Box>
  );
}

/** An item as a link, with its label and description from the local subset where it has them. */
function ItemText({ item, label, description }: { item: string; label: string | null; description: string | null }) {
  const about = [label, description].filter(Boolean).join(', ');
  return (
    <>
      <Link href={wikidataItemUrl(item) ?? undefined} target="_blank" rel="noopener noreferrer">{item}</Link>
      {about && <> — {about}</>}
    </>
  );
}

/**
 * What a place is, in words: the kinds it is in, and for a serial site's part,
 * which is in no kind of its own, the site it is part of (#1250).
 */
function whatItIs(kinds: readonly string[], partOf: string | null): string[] {
  return partOf ? [...kinds, `part of ${partOf}`] : [...kinds];
}

/**
 * The pair on one map (#2202): this card's place first, then the other, each
 * pin saying which place it is and what that place is — so whether Bisotun's
 * caravanserai stands within the World Heritage site, beside it or across the
 * road is read from the map and not from two coordinates. A card whose own
 * place has no point shows the other alone.
 */
function pairPins(item: ReviewQueueItem, pair: Pair): MapPin[] {
  const pins: MapPin[] = [];
  if (item.latitude != null && item.longitude != null) {
    pins.push({
      latitude: item.latitude, longitude: item.longitude,
      label: [`${item.name} (this card)`, ...whatItIs(pair.anchorKinds, pair.anchorPartOf)].join(' · '),
    });
  }
  if (pair.otherLatitude != null && pair.otherLongitude != null) {
    pins.push({
      latitude: pair.otherLatitude, longitude: pair.otherLongitude,
      label: [pair.otherName, ...whatItIs(pair.otherKinds, pair.otherPartOf)].join(' · '),
    });
  }
  return pins;
}

/**
 * The two places' Wikidata items (#1970). One item they share is one link,
 * and the line says whose it is (`anchorItemClaimed`, `otherItemClaimed`,
 * ADR-0143 decision 2, #2194): claimed by both, the strongest sign of one
 * place; one place's own and carried by the other — Q957628 is the Saint
 * Stepanos Monastery's and each of the ensemble's three components carries
 * it, so the question is whether the main church is the monastery or a part
 * of it; or neither's own, as an item several places carry.
 * Two items are each named beside the place that carries it, with the label
 * and description that tell them apart: Babylon's city, Q5684, from the item
 * of its World Heritage listing, Q100329356. A place with no item is said to
 * have none, since a serial site or a place whose point was never written
 * resolves to no item, and silence would read as the same item. `SharedItem`
 * is the one-item line, on its own so each function reads at a glance.
 */
function SharedItem({ item, pair }: { item: ReviewQueueItem; pair: Pair }) {
  const link = <ItemText item={pair.anchorWikidataItem!} label={pair.anchorWikidataLabel} description={pair.anchorWikidataDescription} />;
  if (pair.anchorItemClaimed && pair.otherItemClaimed) {
    return <Typography variant="body2" color="text.secondary">Both claim Wikidata {link} as their own item.</Typography>;
  }
  if (!pair.anchorItemClaimed && !pair.otherItemClaimed) {
    return (
      <Typography variant="body2" color="text.secondary">
        Both carry Wikidata {link}, neither as its own: several places carry it.
      </Typography>
    );
  }
  const [owner, carrier] = pair.anchorItemClaimed ? [item.name, pair.otherName] : [pair.otherName, item.name];
  return (
    <Typography variant="body2" color="text.secondary">
      Wikidata {link} is {owner}’s own item; {carrier} carries it too, as several places do, and only refers to it.
    </Typography>
  );
}

function PairItems({ item, pair }: { item: ReviewQueueItem; pair: Pair }) {
  const anchor = pair.anchorWikidataItem;
  const other = pair.otherWikidataItem;
  if (!anchor && !other) return null;
  if (anchor === other) return <SharedItem item={item} pair={pair} />;
  const anchorPlace = `${item.name} (${['this card', ...whatItIs(pair.anchorKinds, pair.anchorPartOf)].join(', ')})`;
  const otherWhat = whatItIs(pair.otherKinds, pair.otherPartOf);
  const otherPlace = otherWhat.length ? `${pair.otherName} (${otherWhat.join(', ')})` : pair.otherName;
  return (
    <Box sx={{ mt: 0.25 }}>
      <Typography variant="body2" color="text.secondary">
        {anchor && other ? 'Two different Wikidata items:' : 'Only one of the two has a Wikidata item:'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ pl: 1.5 }}>
        {anchorPlace}: {anchor
          ? <ItemText item={anchor} label={pair.anchorWikidataLabel} description={pair.anchorWikidataDescription} />
          : 'no item'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ pl: 1.5 }}>
        {otherPlace}: {other
          ? <ItemText item={other} label={pair.otherWikidataLabel} description={pair.otherWikidataDescription} />
          : 'no item'}
      </Typography>
    </Box>
  );
}

/** One pair: the other place, how the two stand to each other, what Jev makes of it, and the three answers. */
function PairRow({ item, pair, judgement, answer, onAnswer }: {
  item: ReviewQueueItem;
  pair: Pair;
  /** Jev's judgement where this deployment asks it; a suggestion, never a choice. */
  judgement: Judgement | undefined;
  answer: PairAnswer | undefined;
  onAnswer: (answer: PairAnswer | undefined) => void;
}) {
  const [looking, setLooking] = useState(false);
  const toggle = (next: Answer) => {
    if (answer?.answer === next) return onAnswer(undefined);
    // Part of starts with the other place as the part — the common shape, a
    // cathedral inside a site's old town — and the curator can turn it round.
    onAnswer(next === 'part_of' ? { answer: next, partId: pair.otherId } : { answer: next });
  };
  const located = pair.otherLatitude != null && pair.otherLongitude != null;
  const pins = located ? pairPins(item, pair) : [];
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1 }}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <OtherPicture pair={pair} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{pair.otherName}</Typography>
            {pair.otherKinds.map(kind => <Chip key={kind} label={kind} size="small" variant="outlined" />)}
            {pair.otherPartOf && <Chip label={`${partOfLead()}${pair.otherPartOf}`} size="small" variant="outlined" />}
            {pair.exact && <Chip label="same name, same spot" size="small" color="success" variant="outlined" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {distanceLabel(pair.distanceM)} apart · {similarityWords(pair)}
          </Typography>
          <PairItems item={item} pair={pair} />
          {judgement && (
            // In grey, apart from the facts: a judgement is not a state of the places.
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block' }}>
              {judgementWords(judgement)}
            </Typography>
          )}
          {located && (
            <Button size="small" variant="text" onClick={() => setLooking(true)}>
              {pins.length > 1 ? 'Show both on the map' : 'Show where it stands'}
            </Button>
          )}
          {answer?.answer === 'part_of' && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={answer.partId}
              onChange={(_event, partId: number | null) => { if (partId !== null) onAnswer({ answer: 'part_of', partId }); }}
              aria-label={`Which is the part: ${pair.otherName} or ${item.name}`}
              sx={{ mt: 0.5 }}
            >
              <ToggleButton value={pair.otherId}>{pair.otherName} is part of {item.name}</ToggleButton>
              <ToggleButton value={item.id}>{item.name} is part of {pair.otherName}</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            size="small"
            variant={answer?.answer === 'one' ? 'contained' : 'outlined'}
            aria-pressed={answer?.answer === 'one'}
            aria-label={`One place: ${pair.otherName}`}
            onClick={() => toggle('one')}
          >
            One place
          </Button>
          <Button
            size="small"
            color="inherit"
            variant={answer?.answer === 'two' ? 'contained' : 'outlined'}
            aria-pressed={answer?.answer === 'two'}
            aria-label={`Two places: ${pair.otherName}`}
            onClick={() => toggle('two')}
          >
            Two places
          </Button>
          <Button
            size="small"
            color="inherit"
            variant={answer?.answer === 'part_of' ? 'contained' : 'outlined'}
            aria-pressed={answer?.answer === 'part_of'}
            aria-label={`One part of the other: ${pair.otherName}`}
            onClick={() => toggle('part_of')}
          >
            Part of
          </Button>
        </Stack>
      </Stack>
      {located && (
        <PointPreviewDialog
          open={looking}
          onClose={() => setLooking(false)}
          name={pins.length > 1 ? `${item.name} and ${pair.otherName}` : pair.otherName}
          latitude={pins[0].latitude}
          longitude={pins[0].longitude}
          pins={pins}
          // Each place's outline where it has one (#2205): Bisotun's site and its
          // caravanserai ask whether the one stands within the other.
          outlinesOf={[item.id, pair.otherId]}
        />
      )}
    </Box>
  );
}

/** What the curator is told once the answers landed. */
function outcomeOf(name: string, result: MergeProposalsAnswered): string {
  const parts: string[] = [];
  // A pair in both lists was merged and its answer not recorded: one pair,
  // said once as a merge with a note, never as a refusal beside it.
  const merged = new Set(result.merged.map(one => one.proposalId));
  const unrecorded = result.refused.filter(one => merged.has(one.proposalId));
  const refused = result.refused.filter(one => !merged.has(one.proposalId));
  if (result.merged.length > 0) {
    const note = unrecorded.length > 0 ? ` (${unrecorded.length} with the answer unrecorded: ${unrecorded[0].error})` : '';
    parts.push(`${plural(result.merged.length, 'place')} merged into it${note}`);
  }
  if (result.two > 0) parts.push(`${plural(result.two, 'pair')} kept as two places`);
  if (result.partOf > 0) parts.push(`${plural(result.partOf, 'pair')} recorded as part of the other`);
  if (refused.length > 0) parts.push(`${plural(refused.length, 'pair')} refused: ${refused[0].error}`);
  return `${name}: ${parts.join(', ')}`;
}

export function MergeProposalsCard({ item, onDone }: {
  item: ReviewQueueItem;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const pairs = item.merge_pairs ?? [];
  const [answers, setAnswers] = useState<Record<number, PairAnswer>>({});
  const answered = pairs
    .filter(pair => answers[pair.proposalId] !== undefined)
    .map(pair => ({ proposalId: pair.proposalId, ...answers[pair.proposalId] }));
  const exact = pairs.filter(pair => pair.exact);
  const exactLeft = exact.filter(pair => answers[pair.proposalId]?.answer !== 'one').length;

  // Jev's judgement, where this deployment asks Jev (#1249): shown beside each
  // pair, never chosen for the curator. A failed read shows none. Keyed by the
  // pairs as the question is built from them — both names, the distance, the
  // similarity, whether exact, the words matched and whether each place claims
  // its item (#2194) — not by their ids alone: a judgement is about the pair it
  // was asked for, and a card showing a pair the pass measured anew, or a place
  // renamed, asks again rather than showing a cached word.
  const asked = JSON.stringify([
    item.name, ...pairs.map(pair => [
      pair.proposalId, pair.otherName, pair.distanceM, pair.nameSimilarity, pair.exact,
      pair.matchedWords, pair.anchorItemClaimed, pair.otherItemClaimed,
    ]),
  ]);
  const { data: judged } = useQuery({
    queryKey: queryKeys.experience.mergeProposalSuggestions(item.id, asked),
    queryFn: () => suggestMergeProposals(item.id),
    staleTime: 300_000,
    retry: false,
  });
  const judgementOf = (proposalId: number) => judged?.suggestions.find(one => one.proposalId === proposalId);
  // The one-button confirmation takes only the pairs Jev calls one place and
  // is sure of (`JEV_SURE`): which is the part, and a pair it calls two, stay
  // the curator's click.
  const sure = pairs.filter(pair => {
    const judgement = judgementOf(pair.proposalId);
    return judgement?.judgement === 'one' && judgement.confidence >= JEV_SURE;
  });
  const sureLeft = sure.filter(pair => answers[pair.proposalId]?.answer !== 'one').length;

  const save = useMutation({
    mutationFn: () => answerMergeProposals(item.id, answered),
    onSettled: (data, error) => onDone(error ? messageFor(item, error) : outcomeOf(item.name, data!), item.id),
  });

  const set = (proposalId: number, answer: PairAnswer | undefined) => setAnswers(previous => {
    const next = { ...previous };
    if (answer === undefined) delete next[proposalId]; else next[proposalId] = answer;
    return next;
  });
  const confirmOne = (which: Pair[]) => () => setAnswers(previous => {
    const next = { ...previous };
    for (const pair of which) next[pair.proposalId] = { answer: 'one' };
    return next;
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <Typography variant="body2" sx={{ my: 2 }}>
          {plural(pairs.length, 'place')} within reach of this one {pairs.length === 1 ? 'carries' : 'carry'} a name
          alike. For each, say whether the two are one place, two places, or one part of the other. One place keeps
          this entry, the older, and folds the other into it.
        </Typography>

        <Stack spacing={1.5}>
          {pairs.map(pair => (
            <PairRow
              key={pair.proposalId}
              item={item}
              pair={pair}
              answer={answers[pair.proposalId]}
              judgement={judgementOf(pair.proposalId)}
              onAnswer={next => set(pair.proposalId, next)}
            />
          ))}
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} flexWrap="wrap" alignItems="center">
          <Button variant="contained" disabled={answered.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {answered.length === 0 ? 'Save answers' : `Save ${plural(answered.length, 'answer')}`}
          </Button>
          {exact.length > 0 && (
            <Button variant="outlined" disabled={exactLeft === 0 || save.isPending} onClick={confirmOne(exact)}>
              One place for {exact.length === 1 ? 'the exact pair' : `all ${exact.length} exact pairs`}
            </Button>
          )}
          {sure.length > 0 && (
            <Button variant="outlined" disabled={sureLeft === 0 || save.isPending} onClick={confirmOne(sure)}>
              One place for {sure.length === 1 ? 'the pair' : `the ${sure.length} pairs`} Jev is sure of
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
