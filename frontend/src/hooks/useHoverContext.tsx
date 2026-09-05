/**
 * What the pointer is over, published to the few things that draw it.
 *
 * Hover changes on every mouse move across a list, which is why it cannot be
 * React state in a context: a context value is one object, so every consumer
 * re-renders on every move — the map, the list's chrome, the closed dialogs, and
 * the whole of an open card. Reported on the Historic Centre of Saint Petersburg,
 * whose card lists 112 places: the highlighted row trailed the cursor by three to
 * five rows and the map's ring answered seconds late.
 *
 * So hover lives outside React, in a small store, and the context carries only
 * the store and its setters — one object that never changes identity. Nothing
 * re-renders because hover changed; a component re-renders because *its own*
 * selected value changed, which for a place row is the boolean "am I the one".
 * Profiled in the browser on that card: 1489 fibers re-rendered per hover before,
 * and the two rows that actually change after.
 *
 * The rule for `useHoverSelector`: return a primitive, or a reference the store
 * itself holds. A selector that builds an object returns a new one on every read,
 * and `useSyncExternalStore` compares with `Object.is` — a fresh object each time
 * means a re-render each time, which is the thing this file exists to prevent.
 */

import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { ImageCredit } from '../api/experiences';

export interface HoverPreview {
  experienceId: number;
  experienceName: string;
  locationId: number | null;
  locationName: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  /** Whose photograph it is. Carried with the picture, because the card shows one. */
  imageCredit: ImageCredit | null;
  longitude: number;
  latitude: number;
}

export interface HoverState {
  hoveredExperienceId: number | null;
  /** For an object with several places: which one, so the ring lands on it. */
  hoveredLocationId: number | null;
  hoverSource: 'marker' | 'list' | null;
  hoverPreview: HoverPreview | null;
}

export interface HoverStore {
  getState: () => HoverState;
  /** Listeners take no arguments, so this fits `useSyncExternalStore` directly. */
  subscribe: (listener: () => void) => () => void;
}

interface HoverContextType {
  store: HoverStore;
  setHoveredFromMarker: (experienceId: number | null, locationId?: number | null) => void;
  setHoveredFromList: (experienceId: number | null, locationId?: number | null) => void;
  setHoverPreview: (preview: HoverPreview | null) => void;
}

const EMPTY_HOVER: HoverState = {
  hoveredExperienceId: null,
  hoveredLocationId: null,
  hoverSource: null,
  hoverPreview: null,
};

const HoverContext = createContext<HoverContextType | null>(null);

export function HoverProvider({ children }: { children: ReactNode }) {
  const stateRef = useRef<HoverState>(EMPTY_HOVER);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Built once. Every consumer of this context reads it during render, so a value
  // that changed identity would re-render all of them — which is the whole cost
  // this store was written to remove.
  const value = useMemo<HoverContextType>(() => {
    const emit = (next: HoverState) => {
      stateRef.current = next;
      // Copied, because a listener may unsubscribe during the walk — a row
      // unmounting is the ordinary case, since a hover is what scrolls the list.
      for (const listener of [...listenersRef.current]) listener();
    };

    const setHovered = (
      source: 'marker' | 'list',
      experienceId: number | null,
      locationId: number | null,
    ) => {
      const prev = stateRef.current;
      const next: HoverState = {
        hoveredExperienceId: experienceId,
        hoveredLocationId: locationId,
        hoverSource: experienceId ? source : null,
        // Leaving an object takes its card with it; the marker path sets a new
        // preview of its own in the same gesture.
        hoverPreview: experienceId ? prev.hoverPreview : null,
      };
      if (
        next.hoveredExperienceId === prev.hoveredExperienceId
        && next.hoveredLocationId === prev.hoveredLocationId
        && next.hoverSource === prev.hoverSource
        && next.hoverPreview === prev.hoverPreview
      ) return;
      emit(next);
    };

    return {
      store: {
        getState: () => stateRef.current,
        subscribe: (listener: () => void) => {
          listenersRef.current.add(listener);
          return () => { listenersRef.current.delete(listener); };
        },
      },
      setHoveredFromMarker: (experienceId, locationId = null) => setHovered('marker', experienceId, locationId),
      setHoveredFromList: (experienceId, locationId = null) => setHovered('list', experienceId, locationId),
      setHoverPreview: (preview) => {
        const prev = stateRef.current;
        if (prev.hoverPreview === preview) return;
        emit({ ...prev, hoverPreview: preview });
      },
    };
  }, []);

  return <HoverContext.Provider value={value}>{children}</HoverContext.Provider>;
}

function useHoverContext(): HoverContextType {
  const context = useContext(HoverContext);
  if (!context) {
    throw new Error('useHoverContext must be used within a HoverProvider');
  }
  return context;
}

/**
 * The setters, and the store for anything that reacts in an effect rather than
 * in a render. Stable, so reading this never costs a re-render.
 */
export function useHoverActions(): HoverContextType {
  return useHoverContext();
}

/**
 * One value out of the hover state, re-rendering only when *that* value changes.
 *
 * See the note at the top of the file: the selector must return a primitive or a
 * reference the store holds.
 */
export function useHoverSelector<T>(selector: (state: HoverState) => T): T {
  const { store } = useHoverContext();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/**
 * *What* is hovered — the object, the place, and where the hover came from —
 * for the two things that answer a hover outside of a render. Called once on
 * subscribing, so a hover already standing is not missed, and then only when
 * that triple actually changes.
 *
 * The narrowing is not an optimisation. `ExperienceMarkers` answers a hover by
 * writing the preview card's contents, so a subscriber woken by *any* change
 * wakes itself: the first hover of a place recursed until the stack ran out,
 * and every marker on the map went dark with it. A listener that reacts by
 * writing must not listen to what it writes.
 */
export function subscribeToHoverTarget(
  store: HoverStore,
  listener: (state: HoverState) => void,
): () => void {
  let seen = store.getState();
  listener(seen);
  return store.subscribe(() => {
    const next = store.getState();
    if (
      next.hoveredExperienceId === seen.hoveredExperienceId
      && next.hoveredLocationId === seen.hoveredLocationId
      && next.hoverSource === seen.hoverSource
    ) return;
    seen = next;
    listener(next);
  });
}
