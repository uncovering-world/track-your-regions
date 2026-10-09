/**
 * The candidate Wikidata items of a serial World Heritage site's components
 * (#1272): the points whose reference no item records, each with the items
 * the search found beside it, and the curator says of each candidate whether
 * it is the same place.
 *
 * The Dacian frontier is the shape: the fort of Bologa stands 20 m from the
 * point named Bologa and carries the same name, so it is marked *exact* and a
 * button confirms every such candidate at once; a tower 400 m off with a name
 * half alike is read and judged on its own. Every candidate says why it was
 * found — it states it is part of the site, or lies near the point and is of
 * the site's kind — how far off it stands and how alike the names are, and
 * opens on Wikidata and, where the item states a coordinate, on a map beside
 * the point. Nothing is written until the curator saves; a confirmed item
 * becomes the point's as the curator's choice, and its picture and description
 * follow where the item has them.
 */

import { useState } from 'react';
import { Box, Button, Card, CardContent, Chip, Link, Stack, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { answerComponentItems, type AnswerComponentItemsBody } from '../../api/curation';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { plural } from '../../utils/plural';
import { wikidataItemUrl } from '../../utils/wikidataLinks';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { ItemHeader, messageFor } from './queueCard';

type Candidate = NonNullable<ReviewQueueItem['component_items']>[number];
type Answer = AnswerComponentItemsBody['answers'][number]['answer'];

/** The rule that found a candidate, in the words a curator reads. */
const BASIS_WORDS: Record<Candidate['basis'], string> = {
  part_of: 'says it is part of the site',
  near: 'near the point, of the site’s kind',
};

/** How far off the candidate stands, in metres or kilometres; or that it states no coordinate. */
function distanceWords(metres: number): string {
  if (metres < 0) return 'no coordinate';
  if (metres < 1000) return `${metres} m away`;
  return `${(metres / 1000).toFixed(1)} km away`;
}

/** How alike the names are: the same, or a share. */
function similarityWords(candidate: Candidate): string {
  if (candidate.similarity >= 1) return 'the same name';
  return `names ${Math.round(candidate.similarity * 100)} % alike`;
}

/** The candidates by point, in the order the server gave them: the source's order of points, the better candidate first. */
function byPoint(candidates: readonly Candidate[]): Array<{ locationId: number; candidates: Candidate[] }> {
  const groups = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    groups.set(candidate.locationId, [...(groups.get(candidate.locationId) ?? []), candidate]);
  }
  return [...groups].map(([locationId, ofPoint]) => ({ locationId, candidates: ofPoint }));
}

/**
 * The candidate beside its point, on a map: two pins and the distance between
 * them, never a move — confirming an item leaves the point where it is.
 */
function BesideOnMap({ candidate }: { candidate: Candidate }) {
  const [open, setOpen] = useState(false);
  if (candidate.latitude == null || candidate.longitude == null
    || candidate.itemLatitude == null || candidate.itemLongitude == null) return null;
  return (
    <>
      <Link component="button" type="button" variant="caption" underline="hover" onClick={() => setOpen(true)}>
        see both on the map
      </Link>
      <PointPreviewDialog
        open={open}
        onClose={() => setOpen(false)}
        name={candidate.pointName ?? 'The component'}
        latitude={candidate.latitude}
        longitude={candidate.longitude}
        beside={{ latitude: candidate.itemLatitude, longitude: candidate.itemLongitude, label: candidate.label }}
      />
    </>
  );
}

/** One candidate: what it is, why it was found, and the two answers. */
function CandidateRow({ candidate, answer, onAnswer }: {
  candidate: Candidate;
  answer: Answer | undefined;
  onAnswer: (answer: Answer | undefined) => void;
}) {
  const url = wikidataItemUrl(candidate.item);
  const toggle = (next: Answer) => onAnswer(answer === next ? undefined : next);
  return (
    <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ py: 0.75 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {url ? <Link href={url} target="_blank" rel="noopener noreferrer">{candidate.label}</Link> : candidate.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">{candidate.item}</Typography>
          {candidate.exact && <Chip label="same name, same spot" size="small" color="success" variant="outlined" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {BASIS_WORDS[candidate.basis]} · {distanceWords(candidate.distanceM)} · {similarityWords(candidate)}
        </Typography>
        <BesideOnMap candidate={candidate} />
      </Box>
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
        <Button
          size="small"
          variant={answer === 'accepted' ? 'contained' : 'outlined'}
          aria-pressed={answer === 'accepted'}
          aria-label={`Same place: ${candidate.label}`}
          onClick={() => toggle('accepted')}
        >
          Same place
        </Button>
        <Button
          size="small"
          color="inherit"
          variant={answer === 'refused' ? 'contained' : 'outlined'}
          aria-pressed={answer === 'refused'}
          aria-label={`Not it: ${candidate.label}`}
          onClick={() => toggle('refused')}
        >
          Not it
        </Button>
      </Stack>
    </Stack>
  );
}

/** What the curator is told once the answers landed. */
function outcomeOf(name: string, result: { accepted: number; refused: number; pictured: number }): string {
  const parts: string[] = [];
  if (result.accepted > 0) {
    const pictured = result.pictured > 0 ? ` (${result.pictured} with a picture)` : '';
    parts.push(`${plural(result.accepted, 'item')} confirmed${pictured}`);
  }
  if (result.refused > 0) parts.push(`${plural(result.refused, 'candidate')} turned down`);
  return `${name}: ${parts.join(', ')}`;
}

export function ComponentItemsCard({ item, onDone }: {
  item: ReviewQueueItem;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const candidates = item.component_items ?? [];
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const answered = Object.entries(answers).map(([proposalId, answer]) => ({ proposalId: Number(proposalId), answer }));
  const exact = candidates.filter(candidate => candidate.exact);
  const exactLeft = exact.filter(candidate => answers[candidate.proposalId] !== 'accepted').length;
  const points = byPoint(candidates);

  const save = useMutation({
    mutationFn: () => answerComponentItems(item.id, answered),
    onSettled: (data, error) => onDone(error ? messageFor(item, error) : outcomeOf(item.name, data!), item.id),
  });

  const set = (proposalId: number, answer: Answer | undefined) => setAnswers(previous => {
    const next = { ...previous };
    if (answer === undefined) delete next[proposalId]; else next[proposalId] = answer;
    return next;
  });
  // A component is one item and an item one component: confirming a candidate
  // takes the confirmation off the point's other candidates and off the same
  // item proposed for another point, which the server would refuse together.
  const confirm = (candidate: Candidate) => setAnswers(previous => {
    const next = { ...previous };
    for (const other of candidates) {
      if (other.proposalId !== candidate.proposalId && next[other.proposalId] === 'accepted'
        && (other.locationId === candidate.locationId || other.item === candidate.item)) delete next[other.proposalId];
    }
    next[candidate.proposalId] = 'accepted';
    return next;
  });
  const answer = (candidate: Candidate, next: Answer | undefined) => (
    next === 'accepted' ? confirm(candidate) : set(candidate.proposalId, next)
  );
  const confirmExact = () => { for (const candidate of exact) confirm(candidate); };

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <Typography variant="body2" sx={{ my: 2 }}>
          {plural(points.length, 'component')} of this site {points.length === 1 ? 'has' : 'have'} no Wikidata item
          recording {points.length === 1 ? 'its' : 'their'} reference. For each candidate found beside one, say
          whether it is the same place.
        </Typography>

        <Stack spacing={2}>
          {points.map(point => {
            const [first] = point.candidates;
            return (
              <Box key={point.locationId}>
                <Stack direction="row" spacing={1} alignItems="baseline">
                  <Typography variant="subtitle2">{first.pointName ?? `Point #${point.locationId}`}</Typography>
                  {first.pointRef && <Typography variant="caption" color="text.secondary">{first.pointRef}</Typography>}
                </Stack>
                {point.candidates.map(candidate => (
                  <CandidateRow
                    key={candidate.proposalId}
                    candidate={candidate}
                    answer={answers[candidate.proposalId]}
                    onAnswer={next => answer(candidate, next)}
                  />
                ))}
              </Box>
            );
          })}
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} flexWrap="wrap">
          <Button variant="contained" disabled={answered.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {answered.length === 0 ? 'Save answers' : `Save ${plural(answered.length, 'answer')}`}
          </Button>
          {exact.length > 0 && (
            <Button variant="outlined" disabled={exactLeft === 0 || save.isPending} onClick={confirmExact}>
              Confirm {exact.length === 1 ? 'the exact match' : `all ${exact.length} exact matches`}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
