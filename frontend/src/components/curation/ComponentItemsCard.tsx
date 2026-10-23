/**
 * The candidate Wikidata items of a serial World Heritage site's components
 * (#1272): the points whose reference no item records, each with the items
 * the search found beside it, and the curator says of each candidate whether
 * it is the same place.
 *
 * The Dacian frontier is the shape: the fort of Bologa stands 20 m from the
 * point named Bologa and carries the same name, so it is marked *exact* and a
 * button confirms every such candidate at once — except two that compete for
 * one point or one item, which the curator picks between; a tower 400 m off with a name
 * half alike is read and judged on its own. Every candidate says why it was
 * found — it states it is part of the site, lies near the point and is of the
 * site's kind, or carries the component's number under another inscription
 * (#1394) — how far off it stands and how alike the names are, and
 * opens on Wikidata. Nothing is written until the curator saves; a confirmed item
 * becomes the point's as the curator's choice, and its picture and description
 * follow where the item has them.
 *
 * Where the deployment asks Jev (#1272, ADR-0087), each candidate also says
 * what Jev makes of it — the same place, or another — and how sure it is, in
 * grey beside the facts and never chosen for the curator; one button confirms
 * every candidate Jev calls the same place at `JEV_SURE` or more, under the
 * same exception. The two buttons share it: a candidate that competes with any
 * candidate either button would take is left to the curator, so neither button
 * can undo the other's confirmation.
 *
 * The site is the container and each component a part of it (#1342): the
 * header says what the site is made of, each component is a part-card with its
 * own picture, and one map above the parts draws every place of the site with
 * the candidate a curator picks beside its component (`ComponentItemsMap`).
 */

import { useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, IconButton, Link, Stack, Tooltip, Typography } from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  answerComponentItems, suggestComponentItems, type AnswerComponentItemsBody, type ComponentItemSuggestions,
} from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { findComponentItems } from '../../api/admin';
import { useAuth } from '../../hooks/useAuth';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { plural } from '../../utils/plural';
import { wikidataItemUrl } from '../../utils/wikidataLinks';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { ComponentItemsMap, MAP_HEIGHT, type MapFocus, type SitePoint } from './ComponentItemsMap';
import { ItemHeader, messageFor } from './queueCard';

/** The source whose components the search reads: UNESCO's World Heritage sites. */
const UNESCO_SOURCE_ID = 1;

type Candidate = NonNullable<ReviewQueueItem['component_items']>[number];
type Answer = AnswerComponentItemsBody['answers'][number]['answer'];
type Judgement = ComponentItemSuggestions['suggestions'][number];

/**
 * How sure Jev has to be for the one-button confirmation to take a candidate
 * it calls the same place: at 0.9 or more its answers agreed with independent
 * labels on 99 % of a thousand entries (#1249's measurement), against 92 %
 * over all of them.
 */
export const JEV_SURE = 0.9;

/** Where the sticky map stands, and the room a row's control keeps above it: the map's offset, its height and a gap. */
const MAP_TOP = 8;
const MAP_ROOM = MAP_TOP + MAP_HEIGHT + 16;

/** What Jev makes of a candidate, or of a hint (#1913), in the words the caption uses. */
const JUDGEMENT_WORDS: Record<'same' | 'other', string> = {
  same: 'the same place',
  other: 'another place',
};

/**
 * Jev's confidence is the margin between its two options, so a low one is a
 * near coin toss rather than a weak yes: said as leaning, not as saying.
 */
export function judgementWords(judgement: { judgement: 'same' | 'other'; confidence: number }): string {
  const percent = `${Math.round(judgement.confidence * 100)} %`;
  return judgement.confidence < 0.5
    ? `Jev is unsure, leans ${JUDGEMENT_WORDS[judgement.judgement]} · ${percent}`
    : `Jev says ${JUDGEMENT_WORDS[judgement.judgement]} · ${percent}`;
}

/** The rule that found a candidate, in the words a curator reads. */
const BASIS_WORDS: Record<Candidate['basis'], string> = {
  part_of: 'says it is part of the site',
  near: 'near the point, of the site’s kind',
  numbered: 'carries this component’s number under another inscription',
  toponym: 'near the point, of the site’s kind, and named for a place in the component’s name',
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

/**
 * The candidates of a group a one-button confirmation may take: the ones that
 * compete with another of the group for a point or for an item are left out,
 * since a component is one item and an item one component, and which of two
 * to confirm is the curator's call rather than the order's.
 */
export function uncontested(group: readonly Candidate[]): Candidate[] {
  const points = new Map<number, number>();
  const items = new Map<string, number>();
  for (const candidate of group) {
    points.set(candidate.locationId, (points.get(candidate.locationId) ?? 0) + 1);
    items.set(candidate.item, (items.get(candidate.item) ?? 0) + 1);
  }
  return group.filter(candidate => points.get(candidate.locationId) === 1 && items.get(candidate.item) === 1);
}

/** The candidates by point, in the order the server gave them: the source's order of points, the better candidate first. */
function byPoint(candidates: readonly Candidate[]): Array<{ locationId: number; candidates: Candidate[] }> {
  const groups = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    groups.set(candidate.locationId, [...(groups.get(candidate.locationId) ?? []), candidate]);
  }
  return [...groups].map(([locationId, ofPoint]) => ({ locationId, candidates: ofPoint }));
}

/** What the map reads for a candidate: its component, and the item beside it where the item's position is known. */
function focusOf(candidate: Candidate): MapFocus | null {
  if (candidate.latitude == null || candidate.longitude == null) return null;
  const point = {
    locationId: candidate.locationId, name: candidate.pointName ?? 'The component',
    latitude: candidate.latitude, longitude: candidate.longitude,
  };
  const located = candidate.itemLatitude != null && candidate.itemLongitude != null;
  return {
    point,
    candidate: located
      ? { label: candidate.label, latitude: candidate.itemLatitude!, longitude: candidate.itemLongitude!, distance: distanceWords(candidate.distanceM) }
      : null,
  };
}

/** A component's own picture, with its credit under it — or the room it would take, so the part-cards line up. */
function PartPicture({ point }: { point: SitePoint | undefined }) {
  const [failed, setFailed] = useState(false);
  const src = point?.imageUrl ? toThumbnailUrl(extractImageUrl(point.imageUrl) ?? '', 120) : '';
  if (!src || failed) return <Box sx={{ width: 64, flexShrink: 0 }} />;
  return (
    <Box sx={{ width: 64, flexShrink: 0 }}>
      <Box component="img" src={src} alt="" loading="lazy" onError={() => setFailed(true)}
        sx={{ width: 64, height: 56, objectFit: 'cover', borderRadius: 0.5, display: 'block' }} />
      <ImageCreditLine credit={point?.imageCredit} />
    </Box>
  );
}

/** One candidate: what it is, why it was found, what Jev makes of it, and the two answers. */
function CandidateRow({ candidate, judgement, answer, onAnswer, onPick, picked }: {
  candidate: Candidate;
  /** The curator picked this candidate, by a click on its row or with its *Show on the map* button: the map reads it (#1691). */
  onPick: () => void;
  /** Whether the map reads this candidate now. */
  picked: boolean;
  /** Jev's judgement where this deployment asks it; a suggestion, never a choice. */
  judgement: Judgement | undefined;
  answer: Answer | undefined;
  onAnswer: (answer: Answer | undefined) => void;
}) {
  const url = wikidataItemUrl(candidate.item);
  const toggle = (next: Answer) => onAnswer(answer === next ? undefined : next);
  return (
    // Picked, never hovered: a pointer crossing the list on its way to the map would re-target it (#1691).
    // A click anywhere on the row picks it; the keyboard picks with the row's own button, which names the
    // candidate and says which one the map shows (`aria-current`: a pick is one of a set, never toggled off).
    <Stack direction="row" spacing={2} alignItems="flex-start" onClick={onPick} sx={{ py: 0.75, cursor: 'pointer' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Tooltip title="Show on the map" describeChild>
            <IconButton size="small" aria-label={`Show ${candidate.label} on the map`} aria-current={picked || undefined}
              color={picked ? 'primary' : 'default'} onClick={(event) => { event.stopPropagation(); onPick(); }}>
              <PlaceIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {url ? <Link href={url} target="_blank" rel="noopener noreferrer">{candidate.label}</Link> : candidate.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">{candidate.item}</Typography>
          {candidate.exact && <Chip label="same name, same spot" size="small" color="success" variant="outlined" />}
          {candidate.takenBack && <Chip label="taken back" size="small" color="warning" variant="outlined" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {BASIS_WORDS[candidate.basis]} · {distanceWords(candidate.distanceM)} · {similarityWords(candidate)}
        </Typography>
        {candidate.registerCode && (
          <Typography variant="caption" color="text.secondary" display="block">
            {candidate.registerCode}
            {candidate.registerDisagrees && ' · another kind of entry than the site’s other candidates'}
          </Typography>
        )}
        {judgement && (
          // In grey, apart from the facts: a judgement is not a state of the place.
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block' }}>
            {judgementWords(judgement)}
          </Typography>
        )}
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
  // Only this site's candidates: the server leaves another site's out without a word (#1397).
  const answered = candidates
    .filter(candidate => answers[candidate.proposalId] !== undefined)
    .map(candidate => ({ proposalId: candidate.proposalId, answer: answers[candidate.proposalId] }));
  // A candidate a curator confirmed and took back (#1336) is neither button's:
  // the batch that confirmed it in haste must not confirm it again.
  const exactAll = candidates.filter(candidate => candidate.exact && !candidate.takenBack);
  const points = byPoint(candidates);
  const sitePoints = useMemo(() => item.site_points ?? [], [item.site_points]);
  const pointOf = (locationId: number) => sitePoints.find(p => p.locationId === locationId);
  // The candidate the map reads: the one the curator picked, none until then (#1691).
  const [picked, setPicked] = useState<number | null>(null);
  const pickedCandidate = candidates.find(c => c.proposalId === picked);
  const focus = useMemo(() => (pickedCandidate ? focusOf(pickedCandidate) : null), [pickedCandidate]);

  // The same search the admin panel runs, narrowed to this site (#1429), and
  // behind the same role: a curator who corrected a point asks an admin.
  const { isAdmin } = useAuth();
  const searchAgain = useMutation({ mutationFn: () => findComponentItems(UNESCO_SOURCE_ID, item.id) });

  const save = useMutation({
    mutationFn: () => answerComponentItems(item.id, answered),
    onSettled: (data, error) => onDone(error ? messageFor(item, error) : outcomeOf(item.name, data!), item.id),
  });

  // Jev's judgement, where this deployment asks Jev (#1272): shown beside each
  // candidate, never chosen for the curator. A failed read shows none. Keyed
  // by the candidates too: a judgement is about the candidates it was asked
  // for, and a card showing new ones asks again.
  const { data: judged } = useQuery({
    queryKey: queryKeys.experience.componentItemSuggestions(item.id, JSON.stringify(candidates.map(c => c.proposalId))),
    queryFn: () => suggestComponentItems(item.id),
    staleTime: 300_000,
    retry: false,
  });
  const judgementOf = (proposalId: number) => judged?.suggestions.find(one => one.proposalId === proposalId);
  const sureAll = candidates.filter(candidate => {
    if (candidate.takenBack) return false;
    const judgement = judgementOf(candidate.proposalId);
    return judgement?.judgement === 'same' && judgement.confidence >= JEV_SURE;
  });
  // Contested over both buttons' candidates at once: an exact candidate and a
  // sure one for the same point would otherwise undo each other, button by button.
  const offered = new Set(uncontested([...new Set([...exactAll, ...sureAll])]).map(candidate => candidate.proposalId));
  const exact = exactAll.filter(candidate => offered.has(candidate.proposalId));
  const sure = sureAll.filter(candidate => offered.has(candidate.proposalId));
  const exactLeft = exact.filter(candidate => answers[candidate.proposalId] !== 'accepted').length;
  const sureLeft = sure.filter(candidate => answers[candidate.proposalId] !== 'accepted').length;

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
  const confirmSure = () => { for (const candidate of sure) confirm(candidate); };

  return (
    // Visible overflow, since a card clips by default and a clipped ancestor turns the sticky map off.
    <Card variant="outlined" sx={{ overflow: 'visible' }}>
      {/* A control scrolled into view from above lands under the sticky map unless it asks for
          room — every control of the card, the action row's too, and on the control itself,
          since an ancestor's margin does not apply. */}
      <CardContent sx={{ '& a, & button': { scrollMarginTop: MAP_ROOM } }}>
        <ItemHeader item={item} />
        <Typography variant="body2" sx={{ my: 2 }}>
          {plural(points.length, 'component')} of this site {points.length === 1 ? 'has' : 'have'} no Wikidata item
          recording {points.length === 1 ? 'its' : 'their'} reference. For each candidate found beside one, say
          whether it is the same place.
        </Typography>

        {/* Sticky within the card: on a site of dozens of components the row a curator
            reads is far below the map's place, and the map is what the row is read against. */}
        <Box sx={{ position: 'sticky', top: MAP_TOP, zIndex: 2, mb: 2, bgcolor: 'background.paper' }}>
          {focus ? <ComponentItemsMap sitePoints={sitePoints} focus={focus} /> : (
            // The map's room before a pick, so the list does not jump when the map appears.
            <Box sx={{
              height: MAP_HEIGHT, border: 1, borderColor: 'divider', borderRadius: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, textAlign: 'center',
            }}>
              <Typography variant="body2" color="text.secondary">
                {pickedCandidate
                  ? 'This component has no coordinate to show it by.'
                  : 'Pick a candidate below to see it beside its component on the map.'}
              </Typography>
            </Box>
          )}
        </Box>

        <Stack spacing={1.5}>
          {points.map(point => {
            const [first] = point.candidates;
            const reading = pickedCandidate?.locationId === point.locationId;
            return (
              // A part-card of the site, as a work is of its venue; its stripe says which one the map reads.
              <Box
                key={point.locationId}
                sx={{
                  border: 1, borderColor: 'divider', borderLeft: '3px solid', borderRadius: 1, px: 1.5, py: 1,
                  borderLeftColor: reading ? 'primary.main' : 'divider',
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="flex-start">
                  <PartPicture point={pointOf(point.locationId)} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                      <Typography variant="subtitle2">{first.pointName ?? `Point #${point.locationId}`}</Typography>
                      {first.pointRef && <Typography variant="caption" color="text.secondary">{first.pointRef}</Typography>}
                    </Stack>
                    {point.candidates.map(candidate => (
                      <CandidateRow
                        key={candidate.proposalId}
                        candidate={candidate}
                        judgement={judgementOf(candidate.proposalId)}
                        answer={answers[candidate.proposalId]}
                        onAnswer={next => answer(candidate, next)}
                        onPick={() => setPicked(candidate.proposalId)}
                        picked={candidate.proposalId === picked}
                      />
                    ))}
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} flexWrap="wrap" alignItems="center">
          <Button variant="contained" disabled={answered.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {answered.length === 0 ? 'Save answers' : `Save ${plural(answered.length, 'answer')}`}
          </Button>
          {exact.length > 0 && (
            <Button variant="outlined" disabled={exactLeft === 0 || save.isPending} onClick={confirmExact}>
              Confirm {exact.length === 1 ? 'the exact match' : `all ${exact.length} exact matches`}
            </Button>
          )}
          {sure.length > 0 && (
            <Button variant="outlined" disabled={sureLeft === 0 || save.isPending} onClick={confirmSure}>
              Confirm {plural(sure.length, 'candidate')} Jev is sure of
            </Button>
          )}
          {isAdmin && (
            <Button variant="text" disabled={searchAgain.isPending || searchAgain.isSuccess} onClick={() => searchAgain.mutate()}>
              Search this site again
            </Button>
          )}
          {searchAgain.isSuccess && (
            <Typography variant="body2" color="text.secondary">
              Searching this site's components; the queue shows what it finds once the pass ends.
            </Typography>
          )}
          {searchAgain.isError && (
            <Typography variant="body2" color="error">
              {searchAgain.error instanceof Error ? searchAgain.error.message : 'The search could not start.'}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
