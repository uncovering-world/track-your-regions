import type { ComponentProps } from 'react';
import type { ReviewQueueMap } from './ReviewQueueMap';
import { lazyChunk } from '../../../utils/lazyChunk';
import { ChunkBoundary } from '../../shared/ChunkBoundary';
import { LoadingSpinner } from '../../shared/LoadingSpinner';

const ReviewQueueMapChunk = lazyChunk(() => import('./ReviewQueueMap').then(m => ({ default: m.ReviewQueueMap })));

/**
 * The review queue's map (#2477), fetched the first time a curator switches to it: a
 * curator who works the list never loads it. Mounted only while the map is shown, so its
 * WebGL context goes when the list comes back.
 */
export function LazyReviewQueueMap(props: ComponentProps<typeof ReviewQueueMap>) {
  return (
    <ChunkBoundary fallback={<LoadingSpinner padding={4} />}>
      <ReviewQueueMapChunk {...props} />
    </ChunkBoundary>
  );
}
