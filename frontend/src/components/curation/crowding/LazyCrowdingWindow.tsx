import type { ComponentProps } from 'react';
import type { CrowdingWindowDialog } from './CrowdingWindowDialog';
import { lazyChunk } from '../../../utils/lazyChunk';
import { ChunkBoundary } from '../../shared/ChunkBoundary';

const CrowdingWindowChunk = lazyChunk(() => import('./CrowdingWindowDialog').then(m => ({ default: m.CrowdingWindowDialog })));

/**
 * The crowded-city window (#2282), fetched the first time a curator opens it:
 * the review page's chunk carries only the ways in — a card's button and the
 * shadowed arrivals' section — and the window, its map and its list come with
 * the click. Mounted only while open, so its map's WebGL context goes with it.
 */
export function LazyCrowdingWindow(props: ComponentProps<typeof CrowdingWindowDialog>) {
  return (
    <ChunkBoundary>
      <CrowdingWindowChunk {...props} />
    </ChunkBoundary>
  );
}
