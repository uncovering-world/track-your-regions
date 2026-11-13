import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { Box } from '@mui/material';
import type { PlaceParts } from './PlaceParts';
import { lazyChunk } from '../../../utils/lazyChunk';
import { ChunkBoundary } from '../../shared/ChunkBoundary';

const PlacePartsChunk = lazyChunk(() => import('./PlaceParts').then(m => ({ default: m.PlaceParts })));

/**
 * The curator's *Parts* and *Part of* sections (#2118), fetched the first time
 * a curator opens a place's card: a visitor's card carries none of it, and
 * neither does the startup chunk.
 *
 * The section arrives after the card, and grows and shrinks as a curator
 * searches, so it reports each change of its height (`onHeightChange`) to the
 * list that virtualises Map mode's cards, as the card's picture does.
 */
export function LazyPlaceParts({ onHeightChange, ...props }: ComponentProps<typeof PlaceParts> & {
  onHeightChange?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || !onHeightChange || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => onHeightChange());
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange]);
  return (
    <Box ref={box}>
      <ChunkBoundary>
        <PlacePartsChunk {...props} />
      </ChunkBoundary>
    </Box>
  );
}
