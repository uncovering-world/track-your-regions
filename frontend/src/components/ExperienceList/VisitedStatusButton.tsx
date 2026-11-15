import { Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PartialIcon from '@mui/icons-material/IndeterminateCheckBox';
import type { VisitedStatus } from '../../api/visited';
import type { VisitCount } from '../shared/visitWords';

interface VisitedStatusButtonProps {
  visitedStatus: VisitedStatus;
  /** The card's count (`cardVisitCount`): null on an edition and on a whole of one place. */
  count: VisitCount | null;
}

/** What the chip says where there is no count to show. */
const STATE_LABEL: Record<VisitedStatus, string> = {
  not_visited: 'Not visited',
  partial: 'Partly visited',
  visited: 'Visited',
};

const STATE_COLOR = { not_visited: 'default', partial: 'warning', visited: 'success' } as const;

/**
 * Chip showing visited status for multi-location experiences, with the count
 * the place's row shows: the Struve Geodetic Arc's reads "1 of 34 visited".
 * (Individual locations are toggled via checkboxes in the expanded list.)
 */
export function VisitedStatusButton({ visitedStatus, count }: VisitedStatusButtonProps) {
  let statusIcon: React.ReactElement | undefined;
  if (visitedStatus === 'visited') {
    statusIcon = <CheckCircleIcon />;
  } else if (visitedStatus === 'partial') {
    statusIcon = <PartialIcon />;
  }

  return (
    <Chip
      size="small"
      label={count ? `${count.text} visited` : STATE_LABEL[visitedStatus]}
      aria-label={count?.name}
      color={STATE_COLOR[visitedStatus]}
      variant={visitedStatus === 'visited' ? 'filled' : 'outlined'}
      icon={statusIcon}
    />
  );
}
