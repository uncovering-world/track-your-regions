/**
 * Shared centered loading spinner.
 *
 * Replaces the repeated pattern of a Box wrapping CircularProgress
 * used across 15+ components for loading states.
 */

import { Box, CircularProgress } from '@mui/material';

interface LoadingSpinnerProps {
  /** CircularProgress size in px (default: MUI default ~40) */
  size?: number;
  /** Padding shorthand (default: 3) */
  padding?: number | string;
}

export function LoadingSpinner({ size, padding = 3 }: LoadingSpinnerProps) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: padding }}>
      <CircularProgress size={size} />
    </Box>
  );
}
