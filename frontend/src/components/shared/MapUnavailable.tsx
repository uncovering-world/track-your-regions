/**
 * Shown in place of a map when this browser cannot paint one.
 *
 * Deliberately not a loading state. The previous behavior on the main map was
 * a stalled-tiles note reading "Some map areas are still loading — panning and
 * zooming still work", which is false twice over when WebGL is missing: nothing
 * is loading and nothing will pan. A permanent condition has to read as one, or
 * the user waits for a recovery that cannot arrive.
 *
 * The wording names the cause and the remedy, because this is a browser setting
 * the user can actually change — unlike most failures we surface.
 */

import { Box, Typography } from '@mui/material';
import LayersClearOutlined from '@mui/icons-material/LayersClearOutlined';

interface MapUnavailableProps {
  /**
   * What still works on *this* surface, phrased for it. The generic reassurance
   * ("the rest of the page still works") is worth little on a screen whose
   * point is the map, so each caller says what its own fallback path is.
   */
  detail?: string;
  /** Dense layout for small containers — dialogs, side panels. */
  compact?: boolean;
}

export function MapUnavailable({ detail, compact = false }: MapUnavailableProps) {
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: compact ? 120 : 240,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: compact ? 0.75 : 1.25,
        px: 3,
        py: compact ? 2 : 4,
        backgroundColor: 'action.hover',
      }}
    >
      <LayersClearOutlined
        sx={{ fontSize: compact ? 28 : 40, color: 'text.disabled' }}
      />

      <Typography
        variant={compact ? 'body2' : 'subtitle1'}
        sx={{ fontWeight: 600, color: 'text.secondary' }}
      >
        The map can&apos;t be displayed
      </Typography>

      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
        This browser has WebGL turned off, and maps are drawn with it. Turning on
        hardware acceleration in your browser settings brings the map back.
      </Typography>

      {detail && (
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
          {detail}
        </Typography>
      )}
    </Box>
  );
}
