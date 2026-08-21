/**
 * What a hover is allowed to re-render.
 *
 * The list's stutter was never one expensive component: it was a hover reaching
 * everything. Hover lived in a context as React state, so a mouse move across
 * the places of one object re-rendered the map, the list's chrome, and the whole
 * of an open card — 1489 fibers per move on the Historic Centre of Saint
 * Petersburg, and 600-860 ms of blocked main thread, both measured in the
 * browser. This pins the shape that fixed it: the store notifies, and only the
 * components whose own selected value changed re-render.
 *
 * Counting renders is the only way to assert this. Nothing about the rendered
 * output differs between the fast version and the slow one — which is exactly
 * how it regressed in the first place.
 */

import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { HoverProvider, subscribeToHoverTarget, useHoverActions, useHoverSelector } from './useHoverContext';

/** Counts its own renders and shows nothing; one per thing we want to watch. */
function useRenderCount(): number {
  const count = useRef(0);
  count.current += 1;
  return count.current;
}

const renders: Record<string, number> = {};

/** One preview object, so tests can assert on identity rather than shape. */
const PREVIEW = {
  experienceId: 10, experienceName: 'Peterhof', locationId: 2, locationName: 'Grand Palace',
  categoryName: null, category: null, imageUrl: null, imageCredit: null,
  longitude: 29.9, latitude: 59.88,
};

function PlaceRow({ id }: { id: number }) {
  const hovered = useHoverSelector(s => s.hoveredLocationId === id);
  renders[`place-${id}`] = useRenderCount();
  return <span data-testid={`place-${id}`}>{hovered ? 'on' : 'off'}</span>;
}

/** Stands in for the map and the list chrome: reads the setters, draws nothing. */
function ActionsOnly() {
  useHoverActions();
  renders.actionsOnly = useRenderCount();
  return null;
}

let setFromList: (experienceId: number | null, locationId?: number | null) => void;

function Harness() {
  const { setHoveredFromList } = useHoverActions();
  setFromList = setHoveredFromList;
  return (
    <>
      <ActionsOnly />
      <PlaceRow id={1} />
      <PlaceRow id={2} />
      <PlaceRow id={3} />
    </>
  );
}

function renderHarness() {
  for (const key of Object.keys(renders)) delete renders[key];
  return render(<HoverProvider><Harness /></HoverProvider>);
}

describe('hover store', () => {
  it('re-renders only the place the pointer arrived at', () => {
    const { getByTestId } = renderHarness();
    expect(renders['place-1']).toBe(1);

    act(() => { setFromList(10, 2); });

    expect(getByTestId('place-2').textContent).toBe('on');
    // The one that changed, and nothing else. Passed down as a prop this was
    // every row in the card, because the card had to re-render to deliver it.
    expect(renders['place-2']).toBe(2);
    expect(renders['place-1']).toBe(1);
    expect(renders['place-3']).toBe(1);
  });

  it('re-renders the place left behind and the one arrived at, and no others', () => {
    const { getByTestId } = renderHarness();
    act(() => { setFromList(10, 1); });
    act(() => { setFromList(10, 3); });

    expect(getByTestId('place-1').textContent).toBe('off');
    expect(getByTestId('place-3').textContent).toBe('on');
    expect(renders['place-1']).toBe(3);
    expect(renders['place-3']).toBe(2);
    expect(renders['place-2']).toBe(1);
  });

  it('never re-renders a component that only holds the setters', () => {
    renderHarness();
    act(() => { setFromList(10, 1); });
    act(() => { setFromList(10, 2); });
    act(() => { setFromList(null, null); });

    // The map is this component: it reacts to hover in an effect, and rendering
    // it reconciles every source and layer react-map-gl holds.
    expect(renders.actionsOnly).toBe(1);
  });

  it('does not wake a subscriber that answers a hover by writing the preview', () => {
    // The map does exactly this: hearing a hover, it writes what the preview card
    // shows. Subscribed to the whole state it heard its own write and answered it
    // again — the first hover of a place recursed until the stack ran out, and
    // every marker went dark with it. Reproduced from the browser's console.
    let calls = 0;
    let actions: ReturnType<typeof useHoverActions>;
    function MapLike() {
      actions = useHoverActions();
      const { store, setHoverPreview } = actions;
      useEffect(() => subscribeToHoverTarget(store, ({ hoveredExperienceId }) => {
        calls += 1;
        setHoverPreview(hoveredExperienceId ? { ...PREVIEW, experienceId: hoveredExperienceId } : null);
      }), [store, setHoverPreview]);
      return null;
    }
    render(<HoverProvider><MapLike /></HoverProvider>);

    const onSubscribe = calls;
    act(() => { actions.setHoveredFromList(10, 1); });
    expect(calls).toBe(onSubscribe + 1);
  });

  it('drops the preview when the pointer leaves the object', () => {
    let seen: unknown = 'unset';
    function PreviewWatcher() {
      seen = useHoverSelector(s => s.hoverPreview);
      return null;
    }
    let actions: ReturnType<typeof useHoverActions>;
    function Grab() {
      actions = useHoverActions();
      return null;
    }
    render(<HoverProvider><Grab /><PreviewWatcher /></HoverProvider>);

    act(() => { actions.setHoverPreview(PREVIEW); });
    expect(seen).toBe(PREVIEW);

    act(() => { actions.setHoveredFromList(null, null); });
    expect(seen).toBeNull();
  });
});
