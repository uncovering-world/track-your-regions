import { Button } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

/**
 * A whole ticked as a whole, its parts not named: "I was there, I don't
 * remember which part" (#2120).
 */
const WHOLE_TICK_LABEL = 'Visited, not sure which part';

interface WholeVisitButtonProps {
  /** The traveller ticked the whole itself, without naming a part. */
  ticked: boolean;
  onToggle: () => void;
  /** A visit write is on its way: the button waits for it (#2120). */
  disabled?: boolean;
}

/**
 * "I was there, I don't remember which part" (#2120): a whole's own tick, on
 * its card and never on its row, and only on a whole that shows no point of
 * its own (`offersWholeTick`). It reads the whole partly visited until the
 * parts are named. Pressed again, it takes back that one tick and leaves every
 * part the traveller ticked. Its press stops at the button, so the card under
 * it does not take the click.
 */
export function WholeVisitButton({ ticked, onToggle, disabled = false }: WholeVisitButtonProps) {
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
        onToggle();
      }}
    >
      {WHOLE_TICK_LABEL}
    </Button>
  );
}
