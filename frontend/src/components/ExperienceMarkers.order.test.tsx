/**
 * What is painted over what, pinned.
 *
 * MapLibre draws in the order layers are **added**, and react-map-gl adds them
 * in the order they are rendered — so the extent's fill and outline sit under
 * every pin only because its `<Source>` is mounted first in
 * `ExperienceMarkers`. Nothing in the type system says so, and moving a JSX
 * block is the easiest edit in the file: an outline over a pin hides the thing
 * the reader clicked, and a wash over the markers dims them.
 *
 * Pinned as render order rather than with a `beforeId` on each layer because
 * mount order is what this component already relies on for all four of its
 * sources, and `beforeId` would name one layer from another — a second place to
 * keep in step, for a rule the first one states.
 *
 * The map itself is stubbed: nothing here is about WebGL, it is about which
 * element comes first.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HoverProvider } from '../hooks/useHoverContext';

vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: undefined }),
  Source: ({ id, children }: { id: string; children?: ReactNode }) => (
    <div data-source={id}>{children}</div>
  ),
  Layer: ({ id }: { id: string }) => <div data-layer={id} />,
}));

vi.mock('../hooks/useExperienceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useExperienceContext')>()),
  useExperienceContext: () => ({
    experiences: [],
    experiencesLoading: false,
    selectedExperienceId: null,
    toggleSelectedExperience: () => {},
    flyToExperienceId: null,
    clearFlyTo: () => {},
    getExperienceById: () => undefined,
    expandedKindNames: new Set<string>(),
    collapsedExperienceIds: new Set<number>(),
    toggleCollapsedExperience: () => {},
    showLost: false,
  }),
}));

vi.mock('../hooks/useRegionLocations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useRegionLocations')>()),
  useRegionLocations: () => ({ locationsByExperience: {} }),
}));

import { ExperienceMarkers } from './ExperienceMarkers';

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <HoverProvider>
        <ExperienceMarkers regionId={1} />
      </HoverProvider>
    </QueryClientProvider>,
  );
  const order = (attribute: string) => [...container.querySelectorAll(`[${attribute}]`)]
    .map(element => element.getAttribute(attribute));
  return { sources: order('data-source'), layers: order('data-layer') };
}

describe('the order Map mode mounts its sources in', () => {
  it('puts the extent first, so every pin and badge paints over it', () => {
    const { sources } = draw();
    expect(sources[0]).toBe('exp-extent');
    expect(sources).toEqual(['exp-extent', 'exp-markers', 'exp-highlight', 'exp-hover']);
  });

  it('puts both extent layers under the markers, the highlight and the hover ring', () => {
    const { layers } = draw();
    const at = (id: string) => layers.indexOf(id);
    expect(at('exp-extent-fill')).toBeGreaterThanOrEqual(0);
    for (const above of ['exp-markers-points', 'exp-marker-count-badge-bg', 'exp-highlight-point', 'exp-hover-ring']) {
      expect(at('exp-extent-fill')).toBeLessThan(at(above));
      expect(at('exp-extent-line')).toBeLessThan(at(above));
    }
    // And the outline over its own wash, or the 15% fill would sit on the line.
    expect(at('exp-extent-fill')).toBeLessThan(at('exp-extent-line'));
  });
});
