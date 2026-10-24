import { Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PartialIcon from '@mui/icons-material/IndeterminateCheckBox';
import type { VisitedStatus } from '../../api/visited';

interface VisitedStatusButtonProps {
  visitedStatus: VisitedStatus;
  visitedCount: number;
  totalCount: number;
  castPoints?: boolean;
}

/**
 * Chip showing visited status for multi-location experiences
 * (Individual locations are toggled via checkboxes in the expanded list)
 */
export function VisitedStatusButton({
  visitedStatus,
  visitedCount,
  totalCount,
  castPoints = false,
}: VisitedStatusButtonProps) {
  const statusConfig = {
    not_visited: { label: castPoints ? 'Not visited' : `0/${totalCount} Visited`, color: 'default' as const },
    partial: { label: `${visitedCount}/${totalCount} Visited`, color: 'warning' as const },
    visited: { label: castPoints ? 'Visited' : 'All Visited', color: 'success' as const },
  };


  const config = statusConfig[visitedStatus];
  let statusIcon: React.ReactElement | undefined;
  if (visitedStatus === 'visited') {
    statusIcon = <CheckCircleIcon />;
  } else if (visitedStatus === 'partial') {
    statusIcon = <PartialIcon />;
  }

  return (
    <Chip
      size="small"
      label={config.label}
      color={config.color}
      variant={visitedStatus === 'visited' ? 'filled' : 'outlined'}
      icon={statusIcon}
    />
  );
}
