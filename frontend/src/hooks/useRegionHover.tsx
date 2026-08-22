/**
 * Which region the pointer is over, published to the few things that draw it.
 *
 * The experience list learned this shape first — see `useHoverContext.tsx` for
 * the full argument. The short form: hover changes on every mouse move, so as
 * React state in a context it re-rendered every consumer of that context per
 * move. For regions that context was `NavigationContext`, whose twelve
 * consumers include `RegionMapVT` — so dragging the pointer across the region
 * map re-rendered the map itself, both lists, the breadcrumbs and the search
 * box, at mousemove rate (#573).
 *
 * The state here is one primitive — the hovered region or division id — which
 * is why this is its own small store rather than a second field on the
 * experience hover store: the two are different domains with different
 * providers (region hover must reach `RegionList`, which renders outside
 * `ExperienceProvider`), and a primitive needs none of that store's
 * preview-merging rules. The invariants are the same and are pinned the same
 * way, in `regionHoverStore.test.tsx`: a selector re-renders only the component
 * whose own value changed, and holding the setter costs no renders at all.
 */

import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';

export interface RegionHoverStore {
  getState: () => number | null;
  /** Listeners take no arguments, so this fits `useSyncExternalStore` directly. */
  subscribe: (listener: () => void) => () => void;
}

interface RegionHoverContextType {
  store: RegionHoverStore;
  setHoveredRegionId: (id: number | null) => void;
}

const RegionHoverContext = createContext<RegionHoverContextType | null>(null);

export function RegionHoverProvider({ children }: { children: ReactNode }) {
  const stateRef = useRef<number | null>(null);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Built once, so reading the context never costs a render — the whole point.
  const value = useMemo<RegionHoverContextType>(() => ({
    store: {
      getState: () => stateRef.current,
      subscribe: (listener: () => void) => {
        listenersRef.current.add(listener);
        return () => { listenersRef.current.delete(listener); };
      },
    },
    setHoveredRegionId: (id: number | null) => {
      // The map fires mousemove continuously over one polygon; each move
      // re-sets the id it already holds, and must not wake anyone for it.
      if (stateRef.current === id) return;
      stateRef.current = id;
      // Copied, because a listener may unsubscribe during the walk — a row
      // unmounting is the ordinary case in a windowed list.
      for (const listener of [...listenersRef.current]) listener();
    },
  }), []);

  return <RegionHoverContext.Provider value={value}>{children}</RegionHoverContext.Provider>;
}

function useRegionHoverContext(): RegionHoverContextType {
  const context = useContext(RegionHoverContext);
  if (!context) {
    throw new Error('useRegionHoverContext must be used within a RegionHoverProvider');
  }
  return context;
}

/**
 * The setter, and the store for anything that reacts in an effect rather than
 * in a render. Stable, so reading this never costs a re-render.
 */
export function useRegionHoverActions(): RegionHoverContextType {
  return useRegionHoverContext();
}

/**
 * One value out of the hovered id, re-rendering only when *that* value changes.
 * A row asks "am I the one" and gets a boolean; see `useHoverContext.tsx` for
 * why the selector must return a primitive.
 */
export function useRegionHoverSelector<T>(selector: (hoveredId: number | null) => T): T {
  const { store } = useRegionHoverContext();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/**
 * The hovered id for the things that answer a hover outside of a render — the
 * map's feature-state writer and its tooltip. Called once on subscribing, so a
 * hover already standing when the map loads is painted rather than missed.
 */
export function subscribeToRegionHover(
  store: RegionHoverStore,
  listener: (hoveredId: number | null) => void,
): () => void {
  listener(store.getState());
  return store.subscribe(() => listener(store.getState()));
}
