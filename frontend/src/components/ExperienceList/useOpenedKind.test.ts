import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOpenedKind } from './useOpenedKind';

/** The Capitoline Museums (Art Museums 2, Archaeology 5) and the Galleria Doria Pamphilj. */
const CAPITOLINE = 6214;
const DORIA = 6229;
const ARCHAEOLOGY = 5;

describe('the kind a card was opened from', () => {
  it('keeps the kind a click chose while the selection is still arriving through the router', () => {
    const { result, rerender } = renderHook(({ selected }) => useOpenedKind(selected), {
      initialProps: { selected: null as number | null },
    });

    // The click: the row's kind is set urgently, and the render after it still
    // reads no selection, because the address arrives in a transition.
    act(() => result.current.openFrom(CAPITOLINE, ARCHAEOLOGY));
    rerender({ selected: null });
    // Then the transition lands.
    rerender({ selected: CAPITOLINE });

    expect(result.current.openedKindId).toBe(ARCHAEOLOGY);
  });

  it('forgets it when the card closes, so the map reopens the place in its first kind', () => {
    const { result, rerender } = renderHook(({ selected }) => useOpenedKind(selected), {
      initialProps: { selected: CAPITOLINE as number | null },
    });
    act(() => result.current.openFrom(CAPITOLINE, ARCHAEOLOGY));

    rerender({ selected: null });
    rerender({ selected: CAPITOLINE });

    expect(result.current.openedKindId).toBeNull();
  });

  it('forgets it when another place is chosen, even without passing through no selection', () => {
    const { result, rerender } = renderHook(({ selected }) => useOpenedKind(selected), {
      initialProps: { selected: CAPITOLINE as number | null },
    });
    act(() => result.current.openFrom(CAPITOLINE, ARCHAEOLOGY));

    rerender({ selected: DORIA });
    rerender({ selected: CAPITOLINE });

    expect(result.current.openedKindId).toBeNull();
  });
});
