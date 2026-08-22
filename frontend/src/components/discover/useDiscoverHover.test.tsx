/**
 * The dot→pin hand-over, which one store made breakable.
 *
 * The selected object's highlight dots overlap other objects' pins in pixels,
 * and MapLibre delivers one mouse move to the pin's `mousemove` first and the
 * dot's `mouseleave` after (`useDiscoverMap`'s registration order). Before the
 * store, the dot's leave only cleared a *location* id that lived apart from the
 * marker hover; unified, an unconditional clear wiped the pin hover the same
 * gesture had just set — and the marker handler's dedupe key kept it from ever
 * being re-set while the pointer stayed on the pin. The guard under test:
 * a dot's leave clears only a hover that still names a place, because a dot's
 * own hover always does and a pin's never does.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import { HoverProvider, useHoverActions } from '../../hooks/useHoverContext';
import { useDiscoverHover } from './useDiscoverHover';

let actions: ReturnType<typeof useHoverActions>;
function GrabActions() {
  actions = useHoverActions();
  return null;
}

function renderDiscoverHover() {
  const wiring = {
    // No map: every ring path declines to act without one, which is exactly
    // what lets the store logic be tested on its own.
    mapRef: { current: null as maplibregl.Map | null },
    experiences: [],
    drawnCoordsRef: { current: () => [] as [number, number][] },
    selectedExpIdRef: { current: 5 as number | null },
    selectedLocsRef: { current: null },
  };
  return renderHook(() => useDiscoverHover(wiring), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <HoverProvider><GrabActions />{children}</HoverProvider>
    ),
  });
}

describe("useDiscoverHover's highlight-dot callback", () => {
  it('names the selected object and the place on a dot hover, and clears its own hover on leave', () => {
    const { result } = renderDiscoverHover();

    act(() => { result.current.highlightHoverCallbackRef.current(42); });
    expect(actions.store.getState()).toMatchObject({
      hoveredExperienceId: 5, hoveredLocationId: 42, hoverSource: 'marker',
    });

    // Leaving the dot to empty map: the hover still names the dot's place,
    // so it is the dot's to take down.
    act(() => { result.current.highlightHoverCallbackRef.current(null); });
    expect(actions.store.getState().hoveredExperienceId).toBeNull();
  });

  it('does not wipe a pin hover the same mouse move has already set', () => {
    const { result } = renderDiscoverHover();

    // The pointer crosses from a dot onto another object's pin: the pin's
    // mousemove runs first and names its object, with no place …
    act(() => { actions.setHoveredFromMarker(10); });
    // … and the dot's leave runs after, in the same DOM move.
    act(() => { result.current.highlightHoverCallbackRef.current(null); });

    // The hover belongs to the pin now; clearing it here would also stick,
    // because the marker handler's dedupe key already holds this pin.
    expect(actions.store.getState()).toMatchObject({
      hoveredExperienceId: 10, hoverSource: 'marker',
    });
  });
});
