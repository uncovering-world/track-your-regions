/**
 * Shared empty state message.
 *
 * Replaces the repeated pattern of centered Typography with muted text
 * used across 10+ components for "no items found" displays.
 */

import { Box, Typography } from '@mui/material';

interface EmptyStateProps {
  /** Message to display */
  message: string;
  /** Padding shorthand (default: 3) */
  padding?: number | string;
}

export function EmptyState({ message, padding = 3 }: EmptyStateProps) {
  return (
    <Box sx={{ p: padding, textAlign: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
