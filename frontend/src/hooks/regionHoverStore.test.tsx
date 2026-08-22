/**
 * What a region hover is allowed to re-render.
 *
 * The region lists and the region map share one hovered id, and it used to be
 * React state in `NavigationContext` — so every mouse move over a region row or
 * a region polygon re-rendered all twelve consumers of that context, the map
 * with all of its sources among them. This pins the shape that fixes it, the
 * same one `hoverStore.test.tsx` pins for experiences: the store notifies, and
 * only the components whose own selected value changed re-render.
 *
 * Counting renders is the only way to assert this: the rendered output of the
 * fast version and the slow one is identical, which is exactly how the slow one
 * went unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import {
  RegionHoverProvider,
  subscribeToRegionHover,
  useRegionHoverActions,
  useRegionHoverSelector,
} from './useRegionHover';

/** Counts its own renders and shows nothing; one per thing we want to watch. */
function useRenderCount(): number {
  const count = useRef(0);
  count.current += 1;
  return count.current;
}

const renders: Record<string, number> = {};

function RegionRow({ id }: { id: number }) {
  const hovered = useRegionHoverSelector(hoveredId => hoveredId === id);
  renders[`region-${id}`] = useRenderCount();
  return <span data-testid={`region-${id}`}>{hovered ? 'on' : 'off'}</span>;
}

/** Stands in for the map's interaction hook: reads the setter, draws nothing. */
function ActionsOnly() {
  useRegionHoverActions();
  renders.actionsOnly = useRenderCount();
  return null;
}

let setHovered: (id: number | null) => void;

function Harness() {
  const { setHoveredRegionId } = useRegionHoverActions();
  setHovered = setHoveredRegionId;
  return (
    <>
      <ActionsOnly />
      <RegionRow id={1} />
      <RegionRow id={2} />
      <RegionRow id={3} />
    </>
  );
}

function renderHarness() {
  for (const key of Object.keys(renders)) delete renders[key];
  return render(<RegionHoverProvider><Harness /></RegionHoverProvider>);
}

describe('region hover store', () => {
  it('re-renders only the region the pointer arrived at', () => {
    const { getByTestId } = renderHarness();
    expect(renders['region-1']).toBe(1);

    act(() => { setHovered(2); });

    expect(getByTestId('region-2').textContent).toBe('on');
    expect(renders['region-2']).toBe(2);
    expect(renders['region-1']).toBe(1);
    expect(renders['region-3']).toBe(1);
  });

  it('re-renders the region left behind and the one arrived at, and no others', () => {
    const { getByTestId } = renderHarness();
    act(() => { setHovered(1); });
    act(() => { setHovered(3); });

    expect(getByTestId('region-1').textContent).toBe('off');
    expect(getByTestId('region-3').textContent).toBe('on');
    expect(renders['region-1']).toBe(3);
    expect(renders['region-3']).toBe(2);
    expect(renders['region-2']).toBe(1);
  });

  it('never re-renders a component that only holds the setter', () => {
    renderHarness();
    act(() => { setHovered(1); });
    act(() => { setHovered(2); });
    act(() => { setHovered(null); });

    // The map is this component: it answers a hover with `setFeatureState`,
    // and rendering it reconciles every source and layer react-map-gl holds.
    expect(renders.actionsOnly).toBe(1);
  });

  it('does not notify when the same id is set again', () => {
    renderHarness();
    act(() => { setHovered(2); });
    const after = renders['region-2'];
    // The map fires mousemove continuously over one polygon; each move sets
    // the id it already holds, and every one of those must cost nothing.
    act(() => { setHovered(2); });
    expect(renders['region-2']).toBe(after);
  });

  it('hands a subscriber the standing value on subscribe, then only changes', () => {
    // The feature-state effect subscribes when the map loads, which can be
    // after a hover is already standing — called once on subscribe, it paints
    // that hover rather than waiting for the pointer to move again.
    let actions: ReturnType<typeof useRegionHoverActions>;
    function Grab() {
      actions = useRegionHoverActions();
      return null;
    }
    render(<RegionHoverProvider><Grab /></RegionHoverProvider>);
    act(() => { actions.setHoveredRegionId(7); });

    const seen: (number | null)[] = [];
    let unsubscribe: () => void;
    act(() => {
      unsubscribe = subscribeToRegionHover(actions.store, id => { seen.push(id); });
    });
    expect(seen).toEqual([7]);

    act(() => { actions.setHoveredRegionId(9); });
    act(() => { actions.setHoveredRegionId(null); });
    expect(seen).toEqual([7, 9, null]);
    unsubscribe!();
  });
});
