/**
 * A selection whose row is not mounted is brought into the window so it can
 * open (#917) — including the selection a link makes before the list's rows
 * exist. An address naming a card thirty rows down a group used to leave the
 * list at its top: the selection arrived first, the row's index a moment
 * later, and the one attempt to bring the row in had already found nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useListScrollAnchor, type ListScrollWiring } from './useListScrollAnchor';
import type { HoverStore } from '../../hooks/useHoverContext';

/** The Cliff of Bandiagara, about thirty rows down Africa's World Heritage group. */
const BANDIAGARA = 230;
const BANDIAGARA_ROW = 31;
/** Aapravasi Ghat, the group's first row, mounted in the first window. */
const AAPRAVASI = 235;

const quietHover: HoverStore = {
  getState: () => ({ hoveredExperienceId: null, hoveredLocationId: null, hoverSource: null, hoverPreview: null }),
  subscribe: () => () => {},
};

function wiring(overrides: Partial<ListScrollWiring> = {}) {
  const virtualizer = { scrollToIndex: vi.fn(), measureElement: vi.fn() };
  const props: ListScrollWiring = {
    hoverStore: quietHover,
    selectedExperienceId: BANDIAGARA,
    scrollContainerRef: { current: document.createElement('div') },
    itemRefs: { current: new Map() },
    locationRefs: { current: new Map() },
    virtualizer: virtualizer as unknown as Virtualizer<HTMLDivElement, Element>,
    rowIndexByExperience: new Map(),
    ...overrides,
  };
  return { props, scrollToIndex: virtualizer.scrollToIndex };
}

describe('useListScrollAnchor: a selection the window does not hold', () => {
  it('brings the row in once its index is known, when the selection came first', () => {
    const { props, scrollToIndex } = wiring();
    const { rerender } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });
    // The address named the card before the region's rows arrived.
    expect(scrollToIndex).not.toHaveBeenCalled();

    rerender({ ...props, rowIndexByExperience: new Map([[AAPRAVASI, 1], [BANDIAGARA, BANDIAGARA_ROW]]) });

    expect(scrollToIndex).toHaveBeenCalledWith(BANDIAGARA_ROW, { align: 'center' });
  });

  it('brings it in once per selection, not again on every later change of rows', () => {
    // A group toggled, a refetch after a curation action: the rows change and the
    // reader, who may have scrolled on, must not be pulled back.
    const { props, scrollToIndex } = wiring({
      rowIndexByExperience: new Map([[BANDIAGARA, BANDIAGARA_ROW]]),
    });
    const { rerender } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    rerender({ ...props, rowIndexByExperience: new Map([[BANDIAGARA, BANDIAGARA_ROW + 4]]) });

    expect(scrollToIndex).toHaveBeenCalledTimes(1);
  });

  it('leaves a mounted row to open where it is', () => {
    const itemRefs = { current: new Map([[AAPRAVASI, document.createElement('div')]]) };
    const { props, scrollToIndex } = wiring({ selectedExperienceId: AAPRAVASI, itemRefs });
    const { rerender } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });

    rerender({ ...props, rowIndexByExperience: new Map([[AAPRAVASI, 1]]) });

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('brings in the next selection the map makes, as before', () => {
    const { props, scrollToIndex } = wiring({
      selectedExperienceId: null,
      rowIndexByExperience: new Map([[BANDIAGARA, BANDIAGARA_ROW]]),
    });
    const { rerender } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });

    rerender({ ...props, selectedExperienceId: BANDIAGARA });

    expect(scrollToIndex).toHaveBeenCalledWith(BANDIAGARA_ROW, { align: 'center' });
  });

  it('brings the same row in again after the selection was cleared and made again', () => {
    const { props, scrollToIndex } = wiring({
      rowIndexByExperience: new Map([[BANDIAGARA, BANDIAGARA_ROW]]),
    });
    const { rerender } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });
    rerender({ ...props, selectedExperienceId: null });
    rerender({ ...props, selectedExperienceId: BANDIAGARA });

    expect(scrollToIndex).toHaveBeenCalledTimes(2);
  });

  it('brings a row back after a selection in between that never found its index', () => {
    // Bandiagara brought in; then a row the list has no index for yet; then
    // Bandiagara again, long since scrolled out of the window.
    const UNLISTED = 9999;
    const { props, scrollToIndex } = wiring({
      rowIndexByExperience: new Map([[BANDIAGARA, BANDIAGARA_ROW]]),
    });
    const { rerender } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });
    rerender({ ...props, selectedExperienceId: UNLISTED });
    rerender({ ...props, selectedExperienceId: BANDIAGARA });

    expect(scrollToIndex).toHaveBeenCalledTimes(2);
  });
});

describe('useListScrollAnchor: a card that moves between rows of its place (#1262)', () => {
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

  it('aims at the card once per selection, and again where a click moved it', async () => {
    // The Pantheon's card above the groups, moved into its Archaeology row by a
    // click there: the selection is the same, the row is another.
    const { props, scrollToIndex } = wiring({ rowIndexByExperience: new Map([[BANDIAGARA, BANDIAGARA_ROW]]) });
    const { result } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });
    scrollToIndex.mockClear();

    result.current.handleCardOpened(BANDIAGARA);
    await nextFrame();
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    // The row remounting with its card open is not a reason to move the list.
    result.current.handleCardOpened(BANDIAGARA);
    await nextFrame();
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    result.current.expectCardMove(BANDIAGARA);
    result.current.handleCardOpened(BANDIAGARA);
    await nextFrame();
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
  });

  it('leaves another selection\'s aim alone', async () => {
    const { props, scrollToIndex } = wiring({ rowIndexByExperience: new Map([[BANDIAGARA, BANDIAGARA_ROW]]) });
    const { result } = renderHook((p: ListScrollWiring) => useListScrollAnchor(p), { initialProps: props });
    result.current.handleCardOpened(BANDIAGARA);
    await nextFrame();
    scrollToIndex.mockClear();

    result.current.expectCardMove(AAPRAVASI);
    result.current.handleCardOpened(BANDIAGARA);
    await nextFrame();
    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
