import { REGION_REFUSAL_REASON_CODES } from '@tyr/shared/curationLog';
import { ReasonMenu, type Reasoned } from '../shared/ReasonMenu';

/**
 * A curator's *Remove ▾* on a rejected row of a region's list (#863): the
 * place leaves the region, with the reason picked from its list. Its caller
 * holds the clicks that bubble from the menu's portal, so a pick does not
 * toggle the card.
 */
export function RemoveFromRegionMenu({ onRemove }: {
  onRemove: (why: Reasoned<typeof REGION_REFUSAL_REASON_CODES>) => void;
}) {
  return (
    <ReasonMenu
      label="Remove"
      heading="Remove from this region entirely"
      reasons={REGION_REFUSAL_REASON_CODES}
      size="small"
      variant="text"
      color="error"
      onChoose={(reasonCode, note) => onRemove({ reasonCode, note })}
    />
  );
}
