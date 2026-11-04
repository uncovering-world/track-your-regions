/**
 * A place's answers in the crowded-city window (ADR-0180, #2358), by where it
 * stands (`answersOffered`): on a row of the region's list and on the card of
 * its own circle, the same buttons staging the same answer, since an answer is
 * a pin on the place itself. The pressed one is the staged answer, else the
 * pin the place holds; pressing it again takes it back.
 */

import { Button, Stack, Typography } from '@mui/material';
import type { CrowdingAnswer } from '../../../api/crowding';
import { answersOffered, chosenAnswer, type Answerable, type Staging } from './crowdingStaging';

/** A pressed button's colour by answer: keeping on the page blue, not taking red, the rest plain. */
const COLOR: Record<CrowdingAnswer, 'primary' | 'inherit' | 'error'> = {
  list: 'primary',
  publish: 'primary',
  shadow: 'inherit',
  clear: 'inherit',
  refuse: 'error',
};

/** Why a place takes no answer, said where its buttons would stand; null where it takes some. */
function noAnswerReason(place: Answerable & { holdsWorks: boolean }): string | null {
  if (!place.canAnswer) return 'Outside your scope';
  if (place.holdsWorks) return 'Always shown: it holds works';
  if (!place.pinnable) return 'Always shown: its kind never hides this type';
  return null;
}

export function AnswerButtons({ place, staging, frozen = false, size = 'small', onAnswer }: {
  place: Answerable & { holdsWorks: boolean };
  staging: Staging;
  /** A read on its way: the place's buttons take no new answer until it lands. */
  frozen?: boolean;
  size?: 'small' | 'medium';
  onAnswer: (answer: CrowdingAnswer) => void;
}) {
  const offers = answersOffered(place);
  const chosen = chosenAnswer(place, staging);
  if (offers.length === 0) {
    const reason = noAnswerReason(place);
    return reason ? <Typography variant="caption" color="text.secondary">{reason}</Typography> : null;
  }
  return (
    // A click on a button answers; it does not open the place the row stands for.
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap onClick={event => event.stopPropagation()}>
      {offers.map(({ answer, label }) => (
        <Button
          key={answer}
          size={size}
          variant={chosen === answer ? 'contained' : 'outlined'}
          color={COLOR[answer]}
          disabled={frozen}
          aria-pressed={chosen === answer}
          onClick={() => onAnswer(answer)}
          sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap', textTransform: 'none' }}
        >
          {label}
        </Button>
      ))}
    </Stack>
  );
}
