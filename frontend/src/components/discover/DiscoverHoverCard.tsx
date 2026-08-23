/**
 * Names what the pointer is over, over Discover's map.
 *
 * Its own component and its own subscriber to the hover store, the same shape
 * as map mode's `HoverPreviewCard`: the preview changes on every marker the
 * pointer crosses, and when `DiscoverExperienceView` held it as state, each
 * change re-rendered the view that owns the map and every card in the list
 * (#573). Positioned in the bottom-left corner — which is why the fold chip
 * sits at the top centre, since the card would otherwise paint over it.
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useHoverSelector } from '../../hooks/useHoverContext';
import { ImageCreditLine } from '../shared/ImageCreditLine';

export function DiscoverHoverCard() {
  const hoverPreview = useHoverSelector(s => s.hoverPreview);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!hoverPreview) return null;
  const picture = hoverPreview.imageUrl && hoverPreview.imageUrl !== failedUrl
    ? hoverPreview.imageUrl : null;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        zIndex: 3,
        width: 260,
        maxWidth: 'calc(100% - 24px)',
        backgroundColor: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.20)',
        pointerEvents: 'none',
        animation: 'tyrDiscoverHoverIn 170ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      {picture && (
        <Box
          component="img"
          src={picture}
          alt={hoverPreview.experienceName}
          sx={{
            width: '100%',
            maxHeight: 180,
            objectFit: 'contain',
            display: 'block',
            backgroundColor: 'grey.100',
          }}
          // Held as *which* picture failed, not as a flag: this card stays mounted
          // while the pointer crosses objects, so a flag would blank every picture
          // after the first refusal — and four of these URLs in five refuse (#557).
          onError={() => setFailedUrl(hoverPreview.imageUrl)}
        />
      )}
      <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {/* Wherever the work appears, including here. */}
        {picture && <ImageCreditLine credit={hoverPreview.imageCredit} />}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
          {hoverPreview.experienceName}
        </Typography>
        {hoverPreview.categoryName && (
          <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.85 }} noWrap>
            {hoverPreview.categoryName}
          </Typography>
        )}
      </Box>
      <style>{`
        @keyframes tyrDiscoverHoverIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </Box>
  );
}
