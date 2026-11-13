/**
 * The crowded-city window's place view (ADR-0180, #2358): one place of a
 * group in its own circle, beside the map that draws it. Its card shows what
 * the place is — its picture with its credit as a line, enlarged on a press
 * (ADR-0182), and its article — the rule's reading of it with its exact count, and its own
 * answers, which are about it alone. Below, the window's one table
 * (`CrowdingTable`, #2454, #2487): every place of its type within the radius,
 * the ones the card's button counts, as one list by fame with the place itself
 * at its own rank and marked there (`circleRows`, #2486), each drawn as the
 * region's list draws it — its picture, its standing, its answers where the
 * region's list holds it — with its figures in the headings' columns
 * (`FigureTable`, #2400) and its distance. A row above the place is better
 * known and one below less known; a row says in words what the rule does with
 * it where its rank does not (#2420). Each opens its own circle, and the order
 * is the same in every circle, so opening a neighbour moves only the mark: its
 * row is scrolled to only where it is out of view. On a narrow screen the
 * table scrolls sideways.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Chip, Link, Paper, Stack, Typography } from '@mui/material';
import type { CrowdingAnswer, CrowdingGroupPlace, CrowdingPlaceView } from '../../../api/crowding';
import { extractImageUrl, toThumbnailUrl } from '../../../utils/imageUrl';
import { safeHref } from '../../../utils/safeHref';
import { ImageCreditLine } from '../../shared/ImageCreditLine';
import { PictureLightbox } from '../../shared/PictureLightbox';
import { ReaderEditionBeside } from '../../shared/WikipediaArticleLink';
import { AnswerButtons } from './AnswerButtons';
import { circleHeading, circleRows } from './circleGroups';
import { CrowdingRow, CrowdingTable, STANDING_COLOR } from './CrowdingTable';
import { drawnStanding, type Staging } from './crowdingStaging';
import { VenueCreditLine, type FigureColumns } from './FigureTable';
import { distanceWords, nounOf, ruleReading, whyWords, type RuleWords } from './rowWords';

/**
 * The place's picture at a card's size, its credit as a line under it (ADR-0182)
 * while it is on screen; a press opens it enlarged with the full credit
 * (`PictureLightbox`).
 */
function Picture({ name, imageUrl, credit }: Pick<CrowdingPlaceView['place'], 'name' | 'imageUrl'> & {
  credit: CrowdingPlaceView['place']['imageCredit'];
}) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const image = extractImageUrl(imageUrl);
  const small = image ? toThumbnailUrl(image, 250) : '';
  if (!small || failedFor === small) return null;
  return (
    <Box sx={{ flexShrink: 0, width: 160 }}>
      <ButtonBase
        onClick={() => setOpen(true)}
        aria-label={`${name} — enlarge the picture`}
        sx={{ borderRadius: 1, overflow: 'hidden', cursor: 'zoom-in', display: 'block' }}
      >
        <Box component="img" src={small} alt={name} onError={() => setFailedFor(small)}
          sx={{ width: 160, height: 120, objectFit: 'cover', display: 'block' }} />
      </ButtonBase>
      <ImageCreditLine credit={credit} surface="line" />
      <PictureLightbox open={open} onClose={() => setOpen(false)} imageUrl={imageUrl} title={name} credit={credit} />
    </Box>
  );
}

/** Whether a row stands outside the screen or outside a box that scrolls around it. */
function outOfView(row: HTMLElement): boolean {
  const { top, bottom } = row.getBoundingClientRect();
  let shownTop = 0;
  let shownBottom = window.innerHeight;
  for (let box = row.parentElement; box; box = box.parentElement) {
    const { overflowY } = window.getComputedStyle(box);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const edges = box.getBoundingClientRect();
    shownTop = Math.max(shownTop, edges.top);
    shownBottom = Math.min(shownBottom, edges.bottom);
  }
  return top < shownTop || bottom > shownBottom;
}

export function PlaceView({ view, places, rule, staging, columns, frozen = false, hovered, onHover, onOpen, onAnswer }: {
  view: CrowdingPlaceView;
  /**
   * The group's places, as the region's list holds them: a neighbour among them is drawn with its
   * picture, its article and its answers; one outside the group's region, or past a list cut short,
   * with its figures alone.
   */
  places: readonly CrowdingGroupPlace[];
  rule: RuleWords;
  staging: Staging;
  /** The table's columns: the fame and score, and the venues where the kind keeps them. */
  columns: FigureColumns;
  frozen?: boolean;
  hovered: number | null;
  onHover: (membershipId: number | null) => void;
  /** A place around it clicked: its own circle opens. */
  onOpen: (membershipId: number) => void;
  /** An answer staged for the open place, on its card, or for a place around it, in its row. */
  onAnswer: (place: CrowdingGroupPlace, answer: CrowdingAnswer) => void;
}) {
  const { place } = view;
  const rows = circleRows(view);
  const byId = new Map(places.map(entry => [entry.membershipId, entry]));
  const ownRow = useRef<HTMLDivElement>(null);
  const shownPlace = useRef(place.membershipId);
  // Another place opened from the table or the map: the rows the two circles share keep their order, so the
  // table stays where it is, and the newly marked row is scrolled to only where it is out of view.
  useEffect(() => {
    if (shownPlace.current === place.membershipId) return;
    shownPlace.current = place.membershipId;
    const row = ownRow.current;
    if (row && outOfView(row)) row.scrollIntoView({ block: 'nearest' });
  }, [place.membershipId]);
  const articleHref = safeHref(place.wikipediaUrl);
  const drawn = drawnStanding(place, staging);
  // What the rule counts above it and the circle does not list: new arrivals outside the caller's
  // scope, and ones whose source no longer offers them (an admin meets only the second kind).
  const unlisted = view.comparedUnlisted;
  const noun = nounOf(rule, 2);

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <Picture name={place.name} imageUrl={place.imageUrl} credit={place.imageCredit} />
        <Stack spacing={0.75} sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h6" component="h3">{place.name}</Typography>
            {place.standing === 'new' && <Chip size="small" color="warning" variant="outlined" label="New" />}
            {drawn !== place.standing && <Chip size="small" color={STANDING_COLOR[drawn]} label="answer staged" />}
          </Stack>
          {articleHref && (
            <Stack direction="row" spacing={1}>
              <Link href={articleHref} target="_blank" rel="noopener noreferrer" variant="body2" underline="hover">Wikipedia</Link>
              <ReaderEditionBeside article={place.wikipediaUrl} />
            </Stack>
          )}
          <Typography variant="body2">{ruleReading(place, rule, view.typeExempt)}</Typography>
          <AnswerButtons place={place} staging={staging} frozen={frozen} size="medium" onAnswer={answer => onAnswer(place, answer)} />
          <Typography variant="caption" color="text.secondary">
            The answer is about {place.name} alone. Every other {nounOf(rule, 1)} keeps its own standing.
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" component="section" aria-label="The places around it">
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" component="h3">{circleHeading(view, rule)}</Typography>
        </Box>
        <CrowdingTable label="Its figures and the places around it" columns={columns} distance>
          {rows.map(row => {
            if (row.own) {
              return (
                <CrowdingRow
                  key={place.membershipId} own rank={row.rank} rowRef={ownRow} standingWords
                  place={{ ...place, drawn, signals: place }} shown={place} note={null} why={null} answers={null}
                  distance="" columns={columns} hovered={false} onHover={onHover} onOpen={onOpen}
                />
              );
            }
            const { entry } = row;
            const full = byId.get(entry.membershipId);
            return (
              <CrowdingRow
                key={entry.membershipId} rank={row.rank} standingWords
                place={{ ...entry, drawn: full ? drawnStanding(full, staging) : entry.standing, signals: entry }}
                shown={full ?? null}
                note={row.note}
                why={full ? whyWords(full, rule, view.typeExempt) : null}
                answers={full && (
                  <AnswerButtons place={full} staging={staging} frozen={frozen} onAnswer={answer => onAnswer(full, answer)} />
                )}
                distance={distanceWords(entry.distanceM)}
                columns={columns} hovered={hovered === entry.membershipId} onHover={onHover} onOpen={onOpen}
              />
            );
          })}
        </CrowdingTable>
        <VenueCreditLine columns={columns} />
        {unlisted > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ px: 1.5, py: 0.75 }}>
            {`${unlisted} more better known are not listed here: outside your scope, or no longer offered by their source.`}
          </Typography>
        )}
        {place.ruleCrowded && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
            For the rule to show it, fewer than {rule.limit} {noun} better known than it would have to stand within
            {' '}{rule.radiusKm} km.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
