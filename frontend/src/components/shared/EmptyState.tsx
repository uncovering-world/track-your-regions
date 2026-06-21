/**
 * Shared empty state message (Meridian v2).
 *
 * Replaces the repeated pattern of centered Typography with muted text
 * used across 10+ components for "no items found" displays. Now renders a
 * tinted icon medallion + optional title and call-to-action, per the
 * Meridian design system. `message`-only call sites keep working unchanged.
 */

import { Box, Typography, Button } from '@mui/material';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Body text */
  message: string;
  /** Optional display heading (Bricolage) above the message */
  title?: string;
  /** Optional decorative icon shown in the medallion (defaults to a dashed ring) */
  icon?: ReactNode;
  /** Optional call-to-action button below the message */
  action?: { label: string; onClick: () => void };
  /** Padding shorthand (default: 3) */
  padding?: number | string;
}

export function EmptyState({ message, title, icon, action, padding = 3 }: EmptyStateProps) {
  return (
    <Box
      sx={{
        p: padding,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 56,
          height: 56,
          mb: 2,
          borderRadius: '50%',
          bgcolor: 'action.hover',
          color: 'text.disabled',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ?? (
          <Box
            sx={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '2.5px dashed',
              borderColor: 'text.disabled',
            }}
          />
        )}
      </Box>

      {title && (
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '34ch' }}>
        {message}
      </Typography>

      {action && (
        <Button variant="contained" size="small" onClick={action.onClick} sx={{ mt: 2 }}>
          {action.label}
        </Button>
      )}
    </Box>
  );
}
