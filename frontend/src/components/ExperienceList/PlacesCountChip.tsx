import { Tooltip } from '@mui/material';
import { CountChip } from './ExperienceListItem.styles';

/**
 * What the count chip says it will do. Not a control at all where folding is not
 * a question — the chip still carries the count, because "this object has five
 * places" is true whether or not the map draws five pins for it here.
 */
export function foldLabel(foldable: boolean, folded: boolean, drawn: number, total: number): string {
  if (!foldable) return `${total} places`;
  return folded ? `Show all ${drawn} places on the map` : 'Show as a single pin on the map';
}

/**
 * The count of an object's places, and — where folding is a question — the
 * control that folds them. The two are one chip because they are one fact: this
 * object has several places, and you may ask for them as a single pin.
 */
export function PlacesCountChip({ label, tooltip, foldable, folded, onToggle }: {
  label: string;
  tooltip: string;
  foldable: boolean;
  folded: boolean;
  onToggle: () => void;
}) {
  // The row's own click opens the card, and a reader folding a site did not ask
  // for that too.
  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onToggle();
  };

  return (
    <Tooltip title={tooltip}>
      <CountChip
        label={label}
        size="small"
        data-foldable={foldable}
        onClick={foldable ? handleClick : undefined}
        variant={folded && foldable ? 'filled' : 'outlined'}
        color="info"
      />
    </Tooltip>
  );
}

