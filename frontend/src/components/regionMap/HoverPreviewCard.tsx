/**
 * The card that names what the pointer is over, drawn on top of the map.
 *
 * Its own component, and its own subscriber to the hover context, so that the
 * map does not have to be. `RegionMapVT` used to read `hoverPreview` and render
 * this inline, which meant a mouse move across a list of places re-rendered the
 * whole map — react-map-gl reconciling every `<Source>` and `<Layer>` per event.
 * On the Historic Centre of Saint Petersburg's 112 places that was seconds of
 * lag between the pointer and the ring. Here, the only thing a hover re-renders
 * on the map side is this card.
 *
 * It still needs the map: the card sits in the corner away from the point it
 * describes, and only the map can say where on screen that point currently is.
 */

import { useMemo } from 'react';
import { Box, Typography, keyframes } from '@mui/material';
import type { MapRef } from 'react-map-gl/maplibre';
import { useHoverSelector } from '../../hooks/useHoverContext';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from '../shared/ImageCreditLine';

/**
 * The card's entrance, defined next to the thing that plays it.
 *
 * It used to live in a `<style>` block inside `RegionMapVT`, which worked only
 * because that component was the sole renderer and the block rendered
 * unconditionally. This component is exported and standalone now: a second
 * caller would get a card that appears with no animation and no error to say
 * why.
 */
const cardIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

interface HoverPreviewCardProps {
  mapRef: React.RefObject<MapRef | null>;
  mapLoaded: boolean;
}

export function HoverPreviewCard({ mapRef, mapLoaded }: HoverPreviewCardProps) {
  // The store holds this object, so the selector hands back the same reference
  // until the preview itself changes — which is what keeps the card still while
  // the pointer crosses places of the object it already describes.
  const hoverPreview = useHoverSelector(s => s.hoverPreview);

  const image = useMemo(() => {
    if (!hoverPreview) return null;
    const imageUrl = extractImageUrl(hoverPreview.imageUrl);
    return imageUrl ? toThumbnailUrl(imageUrl, 720) : null;
  }, [hoverPreview]);

  const placement = useMemo(() => {
    const fallback = { left: 16, bottom: 16 } as const;
    if (!hoverPreview || !mapRef.current || !mapLoaded) return fallback;
    const map = mapRef.current.getMap();
    const canvas = map.getCanvas();
    const point = map.project([hoverPreview.longitude, hoverPreview.latitude]);
    const placeLeft = point.x >= canvas.clientWidth / 2;
    const placeBottom = point.y < canvas.clientHeight / 2;
    return {
      ...(placeLeft ? { left: 16 } : { right: 16 }),
      ...(placeBottom ? { bottom: 16 } : { top: 86 }),
    };
  }, [hoverPreview, mapLoaded, mapRef]);

  if (!hoverPreview) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        ...placement,
        zIndex: 3,
        width: 260,
        maxWidth: 'calc(100% - 32px)',
        backgroundColor: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.20)',
        pointerEvents: 'none',
        animation: `${cardIn} 170ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
      }}
    >
      {image && (
        <Box
          component="img"
          src={image}
          alt={hoverPreview.experienceName}
          sx={{
            width: '100%',
            maxHeight: 180,
            objectFit: 'contain',
            display: 'block',
            backgroundColor: 'grey.100',
          }}
        />
      )}
      <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {/* The largest picture the map ever shows, so the licence condition
            applies here as much as on the detail panel: the author is named
            wherever the work appears. */}
        {image && <ImageCreditLine credit={hoverPreview.imageCredit} />}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
          {hoverPreview.experienceName}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2 }} noWrap>
          {hoverPreview.locationName || 'Primary location'}
        </Typography>
        {hoverPreview.categoryName && (
          <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.85 }} noWrap>
            {hoverPreview.categoryName}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
