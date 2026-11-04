/**
 * The crowded-city window's place view (ADR-0180, #2358): one place of a
 * group in its own circle, beside the map that draws it. Its card shows what
 * the place is — its picture with its credit as a line, enlarged on a press
 * (ADR-0182), and its article — the rule's reading of it with its exact count, and its own
 * answers, which are about it alone. Below, what it is compared with: the
 * better-known places of its type within the radius, as the rule lists them,
 * best known first, each with its distance and each opening its own circle.
 */

import { useState } from 'react';
import { Box, ButtonBase, Chip, Link, Paper, Stack, Typography } from '@mui/material';
import type { CrowdingAnswer, CrowdingPlaceView } from '../../../api/crowding';
import { extractImageUrl, toThumbnailUrl } from '../../../utils/imageUrl';
import { safeHref } from '../../../utils/safeHref';
import { ImageCreditLine } from '../../shared/ImageCreditLine';
import { PictureLightbox } from '../../shared/PictureLightbox';
import { ReaderEditionBeside } from '../../shared/WikipediaArticleLink';
import { AnswerButtons } from './AnswerButtons';
import { drawnStanding, type Staging } from './crowdingStaging';
import { STANDING_COLOR } from './RegionList';
import { distanceWords, nounOf, ruleReading, type RuleWords } from './rowWords';

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

export function PlaceView({ view, rule, staging, frozen = false, hovered, onHover, onOpen, onAnswer }: {
  view: CrowdingPlaceView;
  rule: RuleWords;
  staging: Staging;
  frozen?: boolean;
  hovered: number | null;
  onHover: (membershipId: number | null) => void;
  /** A compared place clicked: its own circle opens. */
  onOpen: (membershipId: number) => void;
  onAnswer: (answer: CrowdingAnswer) => void;
}) {
  const { place } = view;
  const compared = view.around.filter(entry => entry.compared);
  const articleHref = safeHref(place.wikipediaUrl);
  const drawn = drawnStanding(place, staging);
  const counted = place.outrankedBy ?? 0;
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
          <AnswerButtons place={place} staging={staging} frozen={frozen} size="medium" onAnswer={onAnswer} />
          <Typography variant="caption" color="text.secondary">
            The answer is about {place.name} alone. Every other {nounOf(rule, 1)} keeps its own standing.
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" component="section" aria-label="What it is compared with">
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" component="h3">
            {compared.length === 0 && unlisted === 0
              ? `No better-known ${nounOf(rule, 1)} stands within ${rule.radiusKm} km of it`
              : `What it is compared with · the ${counted} better known within ${rule.radiusKm} km`}
          </Typography>
        </Box>
        {compared.map((entry, index) => (
          <Box
            key={entry.membershipId}
            onMouseEnter={() => onHover(entry.membershipId)}
            onMouseLeave={() => onHover(null)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider',
              bgcolor: hovered === entry.membershipId ? 'action.selected' : undefined,
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ width: 28, fontVariantNumeric: 'tabular-nums' }}>{index + 1}</Typography>
            <ButtonBase
              onClick={() => onOpen(entry.membershipId)}
              sx={{ typography: 'body2', flexGrow: 1, justifyContent: 'flex-start', textAlign: 'left', '&:hover': { textDecoration: 'underline' } }}
            >
              {entry.name}
            </ButtonBase>
            {entry.standing !== 'shown' && (
              <Typography variant="caption" color="text.secondary">{entry.standing === 'new' ? 'new' : 'shadowed'}</Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {distanceWords(entry.distanceM)}
            </Typography>
          </Box>
        ))}
        {unlisted > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ px: 1.5, py: 0.75 }}>
            {`and ${unlisted} not listed here: outside your scope, or no longer offered by their source`}
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
