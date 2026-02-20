import { Tooltip as MuiTooltip, type TooltipProps } from '@mui/material';

/** Tooltip with delayed enter and instant leave to avoid blocking nearby buttons */
export function Tooltip(props: TooltipProps) {
  return <MuiTooltip enterDelay={500} enterNextDelay={300} leaveDelay={0} {...props} />;
}

export interface ShadowInsertion {
  gapDivisionId: number;
  gapDivisionName: string;
  action: 'add_member' | 'create_region';
  targetRegionId: number;
}
