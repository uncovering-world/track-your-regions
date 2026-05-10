import { Chip } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  IndeterminateCheckBox as PartialIcon,
} from '@mui/icons-material';
import type { VisitedStatus } from '../../api/experiences';

interface VisitedStatusButtonProps {
  visitedStatus: VisitedStatus;
  visitedCount: number;
  totalCount: number;
}

/**
 * Chip showing visited status for multi-location experiences
 * (Individual locations are toggled via checkboxes in the expanded list)
 */
export function VisitedStatusButton({
  visitedStatus,
  visitedCount,
  totalCount,
}: VisitedStatusButtonProps) {
  const statusConfig = {
    not_visited: { label: `0/${totalCount} Visited`, color: 'default' as const },
    partial: { label: `${visitedCount}/${totalCount} Visited`, color: 'warning' as const },
    visited: { label: 'All Visited', color: 'success' as const },
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
