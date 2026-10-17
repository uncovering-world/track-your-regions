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
import { useMutation } from '@tanstack/react-query';
import { answerMergeProposals, type AnswerMergeProposalsBody, type MergeProposalsAnswered } from '../../api/curation';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { distanceLabel } from '../../utils/moveDescription';
import { plural } from '../../utils/plural';
import { wikidataItemUrl } from '../../utils/wikidataLinks';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { ItemHeader, messageFor } from './queueCard';

type Pair = NonNullable<ReviewQueueItem['merge_pairs']>[number];
type Answer = AnswerMergeProposalsBody['answers'][number]['answer'];
/** The curator's answer to one pair, with which place is the part where that is the answer. */
interface PairAnswer { answer: Answer; partId?: number }

/** How alike the names are: the same, or a share. */
function similarityWords(pair: Pair): string {
  return pair.nameSimilarity >= 1 ? 'the same name' : `names ${Math.round(pair.nameSimilarity * 100)} % alike`;
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

/** One pair: the other place, how the two stand to each other, and the three answers. */
function PairRow({ item, pair, answer, onAnswer }: {
  item: ReviewQueueItem;
  pair: Pair;
  answer: PairAnswer | undefined;
  onAnswer: (answer: PairAnswer | undefined) => void;
}) {
  const [looking, setLooking] = useState(false);
  const url = wikidataItemUrl(pair.otherWikidataItem ?? '');
  const toggle = (next: Answer) => {
    if (answer?.answer === next) return onAnswer(undefined);
    // Part of starts with the other place as the part — the common shape, a
    // cathedral inside a site's old town — and the curator can turn it round.
    onAnswer(next === 'part_of' ? { answer: next, partId: pair.otherId } : { answer: next });
  };
  const located = pair.otherLatitude != null && pair.otherLongitude != null;
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1 }}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <OtherPicture pair={pair} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{pair.otherName}</Typography>
            {pair.otherKinds.map(kind => <Chip key={kind} label={kind} size="small" variant="outlined" />)}
            {pair.exact && <Chip label="same name, same spot" size="small" color="success" variant="outlined" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {distanceLabel(pair.distanceM)} apart · {similarityWords(pair)}
            {url && <> · <Link href={url} target="_blank" rel="noopener noreferrer">{pair.otherWikidataItem}</Link></>}
            {pair.anchorWikidataItem && pair.otherWikidataItem && pair.anchorWikidataItem !== pair.otherWikidataItem && (
              <> · two different Wikidata items</>
            )}
          </Typography>
          {located && (
            <Button size="small" variant="text" onClick={() => setLooking(true)}>Show where it stands</Button>
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
          name={pair.otherName}
          latitude={pair.otherLatitude!}
          longitude={pair.otherLongitude!}
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

  const save = useMutation({
    mutationFn: () => answerMergeProposals(item.id, answered),
    onSettled: (data, error) => onDone(error ? messageFor(item, error) : outcomeOf(item.name, data!), item.id),
  });

  const set = (proposalId: number, answer: PairAnswer | undefined) => setAnswers(previous => {
    const next = { ...previous };
    if (answer === undefined) delete next[proposalId]; else next[proposalId] = answer;
    return next;
  });
  const confirmExact = () => setAnswers(previous => {
    const next = { ...previous };
    for (const pair of exact) next[pair.proposalId] = { answer: 'one' };
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
              onAnswer={next => set(pair.proposalId, next)}
            />
          ))}
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} flexWrap="wrap" alignItems="center">
          <Button variant="contained" disabled={answered.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {answered.length === 0 ? 'Save answers' : `Save ${plural(answered.length, 'answer')}`}
          </Button>
          {exact.length > 0 && (
            <Button variant="outlined" disabled={exactLeft === 0 || save.isPending} onClick={confirmExact}>
              One place for {exact.length === 1 ? 'the exact pair' : `all ${exact.length} exact pairs`}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
