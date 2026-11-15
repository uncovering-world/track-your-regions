import { useEffect } from 'react';
import { Button } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { askWhichPlaces, stopAsking } from './wholeAsk';

/**
 * A whole ticked as a whole, its parts not named: "I was there, I don't
 * remember which part" (#2120).
 */
const WHOLE_TICK_LABEL = 'Visited, not sure which part';

interface WholeVisitButtonProps {
  /** The whole the button ticks, whose card asks which places once it is ticked (#2121). */
  experienceId: number;
  /** The traveller ticked the whole itself, without naming a part. */
  ticked: boolean;
  onToggle: () => void;
  /** A visit write is on its way: the button waits for it (#2120). */
  disabled?: boolean;
}

/**
 * "I was there, I don't remember which part" (#2120): a whole's own tick, on
 * its card and never on its row, and only on a whole that shows no point of
 * its own (`offersWholeTick`). It makes the whole visited, its count "? of N"
 * until the places are named (ADR-0206), and the card then asks which places
 * (`WholeVisitAsk`, #2121). Pressed again, it takes back that one tick and
 * leaves every part the traveller ticked. The question lasts no longer than
 * the button: it goes with the card, so a later open does not ask again. Its
 * press stops at the button, so the card under it does not take the click.
 */
export function WholeVisitButton({ experienceId, ticked, onToggle, disabled = false }: WholeVisitButtonProps) {
  useEffect(() => () => stopAsking(experienceId), [experienceId]);
  return (
    <Button
      size="small"
      variant={ticked ? 'contained' : 'outlined'}
      color={ticked ? 'success' : 'primary'}
      aria-pressed={ticked}
      disabled={disabled}
      startIcon={ticked ? <CheckCircleIcon /> : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (ticked) stopAsking(experienceId);
        else askWhichPlaces(experienceId);
        onToggle();
      }}
    >
      {WHOLE_TICK_LABEL}
    </Button>
  );
}
