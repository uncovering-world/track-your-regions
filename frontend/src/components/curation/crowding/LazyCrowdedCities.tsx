import type { ComponentProps } from 'react';
import type { CrowdedCities } from './CrowdedCities';
import { lazyChunk } from '../../../utils/lazyChunk';
import { ChunkBoundary } from '../../shared/ChunkBoundary';
import { LoadingSpinner } from '../../shared/LoadingSpinner';

const CrowdedCitiesChunk = lazyChunk(() => import('./CrowdedCities').then(m => ({ default: m.CrowdedCities })));

/**
 * The review page's *Crowded cities* tab (#2282), fetched the first time a
 * curator opens it: the review page's chunk carries only the tab and its
 * count, and the list, the window, its map and its table come with the click.
 * Mounted only while the tab is open, so the map's WebGL context goes with it.
 */
export function LazyCrowdedCities(props: ComponentProps<typeof CrowdedCities>) {
  return (
    <ChunkBoundary fallback={<LoadingSpinner padding={4} />}>
      <CrowdedCitiesChunk {...props} />
    </ChunkBoundary>
  );
}
