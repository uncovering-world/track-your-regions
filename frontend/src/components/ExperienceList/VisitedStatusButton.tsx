import { Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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
  visited: 'Visited',
};

/**
 * Chip showing visited status for multi-location experiences, with the count
 * the place's row shows: the Struve Geodetic Arc's reads "1 of 34 visited",
 * visited since its first station (ADR-0206).
 * (Individual locations are toggled via checkboxes in the expanded list.)
 */
export function VisitedStatusButton({ visitedStatus, count }: VisitedStatusButtonProps) {
  const visited = visitedStatus === 'visited';
  return (
    <Chip
      size="small"
      label={count ? `${count.text} visited` : STATE_LABEL[visitedStatus]}
      aria-label={count?.name}
      color={visited ? 'success' : 'default'}
      variant={visited ? 'filled' : 'outlined'}
      icon={visited ? <CheckCircleIcon /> : undefined}
    />
  );
}
