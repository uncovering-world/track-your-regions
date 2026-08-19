/**
 * Where the experience list scrolls, and why it mostly does not.
 *
 * Four movements live here, and every one of them exists because a reader
 * complained about the list moving on its own — so each is narrower than it
 * looks: a hover from the map centres the row it points at, a selection made
 * from the map brings its row into the window before the card can open, the card
 * itself is aimed at once per selection, and a row that the view filter moved out
 * from under an open card is re-aimed at only when the reader can no longer see
 * it (#553).
 *
 * Split out of `ExperienceList` when the fourth arrived and pushed that file past
 * the 800-line rule in `docs/tech/development-guide.md`. It keeps the three refs
 * the four share — which selection has been scrolled for, which index the open
 * card was aimed at, and the row-index map read through a ref rather than a
 * dependency — in one place, where the reasons for them can be read together.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { subscribeToHoverTarget, type HoverStore } from '../../hooks/useHoverContext';
import { scrollToCenter, scrollToTop } from '../../utils/scrollUtils';

export interface ListScrollWiring {
  /**
   * Subscribed to, never rendered from: only one of the four movements below
   * answers a hover, and the list that owns this hook builds every row it has.
   */
  hoverStore: HoverStore;
  selectedExperienceId: number | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  itemRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  locationRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Where each experience sits in the flat rows, rebuilt whenever they change. */
  rowIndexByExperience: Map<number, number>;
}

/** The list hands this to a row so it can say when its card is ready to be seen. */
export interface ListScroll {
  /** Called by a row when its card is ready, so the list can aim at it once. */
  handleCardOpened: (experienceId: number) => void;
  /** Called by a row when its height changed, so the virtualiser re-measures it. */
  measureRow: (experienceId: number) => void;
  /** Said by the list where it asks the map to fly, naming the row it flew for. */
  expectFlight: (experienceId: number) => void;
}

export function useListScrollAnchor({
  hoverStore,
  selectedExperienceId,
  scrollContainerRef,
  itemRefs,
  locationRefs,
  virtualizer,
  rowIndexByExperience,
}: ListScrollWiring): ListScroll {
  // Read through a ref, deliberately absent from the effects' dependencies: the
  // map is rebuilt whenever the rows change, and a change of rows is not a change
  // of selection — depending on it would scroll the reader back to the selected
  // row every time a group is expanded or the region's experiences are refetched.
  const rowIndexRef = useRef(rowIndexByExperience);
  rowIndexRef.current = rowIndexByExperience;
  // The open row, for callbacks that outlive the render that made them.
  const selectedIdRef = useRef(selectedExperienceId);
  selectedIdRef.current = selectedExperienceId;
  /** Open while the flight a click started can still move the rows. */
  const flightWindowRef = useRef(false);
  /**
   * Set by the list where it asks for a flight, and consumed when the card opens.
   *
   * Without it the window would be armed by *any* card opening — a marker click
   * selects a row and moves no camera — and a window over no flight is a window
   * over whatever the reader does next, which is the pan this all exists to keep
   * out of.
   */
  const flightExpectedRef = useRef<{ id: number; at: number } | null>(null);
  const flightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A little longer than the 800 ms flight, so the row change it causes lands
   * inside the window and anything the reader does afterwards lands outside it.
   */
  const FLIGHT_WINDOW_MS = 1200;

  // Scroll to item only when hovered from map marker (not from list hover)
  // Use manual scrolling to avoid affecting page scroll
  // If hoveredLocationId is set and the location is visible, scroll to it; otherwise scroll to the experience
  //
  // Subscribed to the hover store rather than fed by props: a hover changes on
  // every mouse move, and taking it as a dependency meant the list re-rendered
  // for each one — which is what made hovering a 112-place card feel stuck. Only
  // a hover *from the map* does anything here, and that is a rare event.
  useEffect(() => {
    // The one frame this hook ever waits, tracked so unmounting can take it
    // back. The staleness check inside it cannot: it asks what is hovered, and
    // a list that is going away does not change that — so the callback would
    // wake in a torn-down list and scroll a detached container, or ask a
    // virtualiser for a row that no longer exists.
    let pendingFrame: number | null = null;
    const unsubscribe = subscribeToHoverTarget(hoverStore, (
      { hoveredExperienceId, hoveredLocationId, hoverSource },
    ) => {
      if (!hoveredExperienceId || hoverSource !== 'marker' || !scrollContainerRef.current) return;
      const container = scrollContainerRef.current;

      /** The object's row, for when its place is not the thing to aim at. */
      const aimAtRow = () => {
        // Ask the virtualiser rather than the DOM. This is the case windowing
        // creates: the row the marker points at is usually not rendered, so
        // `itemRefs` has nothing for it, and before this the hover silently
        // scrolled nowhere for every row outside the window.
        const index = rowIndexRef.current.get(hoveredExperienceId);
        if (index != null) {
          // `behavior` stays the virtualiser's default. The helpers this replaced
          // glided (`scrollUtils.ts` passes `smooth`), but TanStack documents smooth
          // scrolling as unsupported alongside the dynamic measurement the rows
          // need, and a jump to the right row beats a glide to a stale offset.
          virtualizer.scrollToIndex(index, { align: 'center' });
          return;
        }
        // Rendered but absent from the flat list, which is what a rejected row is:
        // those render outside the virtualiser, so they have an element and no
        // index. Keep the element path for them.
        const element = itemRefs.current.get(hoveredExperienceId);
        if (element) scrollToCenter(container, element);
      };

      // The place, when it has an element — it is the precise thing being
      // hovered. It has one only inside a row that is open, rendered, and
      // showing that place; the block below is every other case.
      const locationElement = hoveredLocationId
        ? locationRefs.current.get(hoveredLocationId)
        : undefined;
      if (locationElement) {
        scrollToCenter(container, locationElement);
        return;
      }
      if (!hoveredLocationId) {
        aimAtRow();
        return;
      }

      // A place with no element yet, which an open card's cap is one cause of:
      // it shows `IN_REGION_INITIAL` of them, and unfolds itself for exactly this
      // hover (`CardLocationList`). Nothing brings us back here when it
      // does — this listener answers a change of *what* is hovered, and unfolding
      // is not one — so the second look is ours to take, one frame on, by which
      // time the unfold has committed. Deciding between the place and the row is
      // deferred with it: taken now, the row scroll would run for every capped
      // place and the list would move twice for one hover.
      if (pendingFrame != null) cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        // The pointer can leave in the frame we waited: without this check the
        // list is pulled back to the place the reader has just moved off, after
        // it has already answered the pin they moved to. Asked of the store
        // rather than remembered, so "they moved on" and "they stopped hovering"
        // are the same check.
        const now = hoverStore.getState();
        if (now.hoverSource !== 'marker'
          || now.hoveredExperienceId !== hoveredExperienceId
          || now.hoveredLocationId !== hoveredLocationId) return;
        const unfolded = locationRefs.current.get(hoveredLocationId);
        if (unfolded && scrollContainerRef.current) {
          scrollToCenter(scrollContainerRef.current, unfolded);
          return;
        }
        // Still absent means the place is not in this card at all — a marker of
        // an object whose row is not open — so the row is the precise answer.
        aimAtRow();
      });
    });
    return () => {
      unsubscribe();
      if (pendingFrame != null) cancelAnimationFrame(pendingFrame);
    };
  },
  // `itemRefs`/`locationRefs` are arguments now rather than locals, so the rule
  // cannot tell they are stable; a ref object never changes identity, so listing
  // them changes nothing about when this runs.
  [hoverStore, scrollContainerRef, virtualizer, itemRefs, locationRefs]);

  // Scroll the selected row to the top, so its description is what the reader
  // faces — but only once its card has opened, never at the click.
  //
  // The two are not the same moment: a card waits for the things that decide its
  // size, which took 315 ms and 1025 ms on two measured rows. Scrolling at the
  // click took the reader to a row that was still collapsed and still waiting, and
  // then the card opened and moved everything again — the list appearing to drift
  // on its own, which is exactly what this was meant to stop.
  //
  // Selection is exclusive, so choosing this row also collapses whichever was
  // open; by the time the new card is ready that collapse has long been measured,
  // which the old 64 ms delay existed to wait for.
  // Which selection the list has already moved for. Reset during render rather
  // than in an effect: the row's effect fires before this component's own, so a
  // reset that ran afterwards would clear the mark for the selection that had
  // just used it, and the next remount would scroll again.
  const scrolledForSelection = useRef<number | null>(null);
  /** The row index the open card was last aimed at, so a moved row can be told from a still one. */
  const anchoredIndexRef = useRef<number | null>(null);
  const [trackedSelection, setTrackedSelection] = useState(selectedExperienceId);
  if (selectedExperienceId !== trackedSelection) {
    setTrackedSelection(selectedExperienceId);
    scrolledForSelection.current = null;
    // The anchor belongs to the row that was open; a new selection has not been
    // aimed at yet, and the old index must not be read as that one's. The
    // flight window closes with it — a new selection opens its own.
    anchoredIndexRef.current = null;
    flightWindowRef.current = false;
  }
  // An expectation whose row is not the current selection was never collected —
  // a marker click on another object deselects without passing through the list —
  // and left standing it would be collected later by a click on that row that
  // flies nothing. Checked every render rather than only on a change, since the
  // selection can return to the row an expectation names. Safe on the opening
  // click too: `handleClick` says `expectFlight` in the same handler as
  // `toggleSelectedExperience`, so by this render it already names the selection.
  if (flightExpectedRef.current?.id !== selectedExperienceId) flightExpectedRef.current = null;

  // A row that is not mounted cannot open, so a selection made from the map —
  // a marker click on a row far outside the window — is brought into the window
  // first. Its own alignment comes later, from `handleCardOpened`.
  useEffect(() => {
    if (!selectedExperienceId || itemRefs.current.has(selectedExperienceId)) return;
    const index = rowIndexRef.current.get(selectedExperienceId);
    if (index != null) virtualizer.scrollToIndex(index, { align: 'center' });
  }, [selectedExperienceId, virtualizer, itemRefs]);

  // Hands the virtualiser this row's height in the layout phase of the commit
  // that changed it — before paint, and therefore before the rows below are drawn
  // at offsets computed for the old one. `VirtualRow` cannot do this: it has no
  // state, so it does not re-render when a card opens.
  //
  // This is enough only because the card is mounted straight into the row: with a
  // `Collapse` around it the height arrived a task later, in a commit where nothing
  // measured, and no amount of flushing here reached it. Tried and dropped:
  // `flushSync` around this call, which the frame-by-frame spec shows is not needed
  // and which costs a forced render per opening. If that spec ever reports a frame
  // again, it is the first thing to reach for.
  const measureRow = useCallback((experienceId: number) => {
    const row = itemRefs.current.get(experienceId)?.closest('li');
    // The attribute is the virtualiser's only way back to an index; without it the
    // library logs a missing-attribute warning and measures nothing. Rejected rows
    // render outside the window and legitimately have none.
    if (!row || !row.hasAttribute('data-index')) return;
    virtualizer.measureElement(row as HTMLElement);
  }, [virtualizer, itemRefs]);

  // Scroll to the selected row when its card has opened, and only then. The row
  // is what knows: readiness is decided per row, and a second gate kept here
  // started its patience at a different moment, so it could call a card open
  // while the row still had it closed — a scroll to a row that is still waiting,
  // which is the drift this exists to remove.
  const handleCardOpened = useCallback((experienceId: number) => {
    // Taken here, above every return below, and matched against the row it was
    // made for: the expectation belongs to the click that opened this card, and
    // one that survives it would arm a window for a later selection — a marker
    // click flies nothing, and would inherit this one's flight. The match is
    // what covers a click whose card never opens at all, which is what closing
    // a row again while it is still loading gives.
    const expected = flightExpectedRef.current;
    const flightExpected = expected?.id === experienceId;
    // Cleared only by the row it names. A card can open for a row the reader
    // has already moved on from — they clicked B while A was still loading —
    // and clearing unconditionally there would spend B's expectation on A's
    // opening, leaving B's own re-aim disarmed. Everything else is covered by
    // the invariant above: an expectation lives only while its row is the
    // selection, so leaving that row by any route drops it.
    if (flightExpected) flightExpectedRef.current = null;

    const container = scrollContainerRef.current;
    if (!container || experienceId !== selectedIdRef.current) return;
    // Once per selection, because the row reports on mount rather than on a
    // transition and a windowed row mounts afresh every time the reader scrolls
    // back to it. Without this, returning to an open card scrolls the list to
    // that card while the reader is the one scrolling — their gesture fighting a
    // `scrollTop` assignment, repeated on every re-entry. The row cannot tell the
    // difference itself: a marker click on a distant row mounts with its card
    // already open, so there is no transition there to observe either.
    if (scrolledForSelection.current === experienceId) return;
    scrolledForSelection.current = experienceId;

    // One frame, so the card that just mounted is measured before its row is
    // aimed at: `scrollToIndex` reads the sizes the virtualiser holds now.
    requestAnimationFrame(() => {
      const index = rowIndexRef.current.get(experienceId);
      if (index == null) {
        const element = itemRefs.current.get(experienceId);
        if (element) scrollToTop(container, element);
        return;
      }

      // Move as little as the reader can be shown the card with. A list that
      // jumps when it did not have to is the complaint this whole change exists
      // to answer, and a card opened in the middle of the viewport usually needs
      // no movement at all.
      anchoredIndexRef.current = index;
      // Only where a flight was actually asked for, and only for what is left of
      // that flight's window. Measured from the click rather than from here: a
      // card is ready anywhere between 315 ms and about a second, and starting a
      // fresh 1200 ms at the slow end would leave the tail lying over the
      // reader's own gestures long after the camera had settled.
      const left = expected ? FLIGHT_WINDOW_MS - (performance.now() - expected.at) : 0;
      flightWindowRef.current = flightExpected && left > 0;
      if (flightTimerRef.current) clearTimeout(flightTimerRef.current);
      if (flightWindowRef.current) {
        flightTimerRef.current = setTimeout(() => { flightWindowRef.current = false; }, left);
      }
      const row = itemRefs.current.get(experienceId)?.closest('li');
      const view = container.getBoundingClientRect();
      if (row) {
        const rect = row.getBoundingClientRect();
        if (rect.top >= view.top - 1 && rect.bottom <= view.bottom + 1) return;
        // A card taller than the viewport is read from its top; a shorter one
        // only needs bringing into view, which `auto` does by the smallest amount.
        virtualizer.scrollToIndex(index, { align: rect.height >= view.height ? 'start' : 'auto' });
        return;
      }
      virtualizer.scrollToIndex(index, { align: 'start' });
    });
  }, [scrollContainerRef, virtualizer, itemRefs]);

  /**
   * Re-aim at the open card when the flight the click started moved the rows
   * under it (#553).
   *
   * A list click flies the map, and the camera settling republishes the view,
   * which changes what is listed — so the row the reader opened can land at a
   * different index half a second after it was scrolled to. Measured on this
   * list, a card is ready at 315 ms where the flight takes 800: the fast path,
   * the one hover-prefetching exists to make common, is the one that drifts.
   *
   * Three gates, and the first is the one that matters. `rowIndexByExperience`
   * changes whenever the rows change *at all* — a group toggled, a refetch
   * after a curation action — so without a window this would scroll the reader
   * back to their open card when they collapse a group they are reading, which
   * is the very complaint this file exists to answer. The window is the click's
   * own flight: armed where the card is aimed at, and closed a little after the
   * 800 ms `fitBounds`/`flyTo` can have settled. A pan the reader makes later
   * is not armed, and never moves the list under them.
   *
   * The other two: the index must actually have moved, and the row must have
   * left the screen. A row still in front of the reader keeps its place.
   *
   * "The click's flight" is literal: the window opens only where the list
   * asked for one. A selection made from the map moves no camera, and arming
   * there would put a window over the reader's own next gesture.
   */
  useEffect(() => {
    const id = selectedIdRef.current;
    const anchored = anchoredIndexRef.current;
    const container = scrollContainerRef.current;
    if (!flightWindowRef.current || id == null || anchored == null || !container) return;
    const index = rowIndexByExperience.get(id);
    if (index == null || index === anchored) return;

    const row = itemRefs.current.get(id)?.closest('li');
    if (row) {
      const rect = row.getBoundingClientRect();
      const view = container.getBoundingClientRect();
      if (rect.bottom > view.top && rect.top < view.bottom) {
        // Still in front of the reader; only the bookkeeping needs to move.
        anchoredIndexRef.current = index;
        return;
      }
    }
    anchoredIndexRef.current = index;
    flightWindowRef.current = false;
    virtualizer.scrollToIndex(index, { align: 'start' });
  }, [rowIndexByExperience, scrollContainerRef, virtualizer, itemRefs]);
  const expectFlight = useCallback((experienceId: number) => {
    // Stamped, because the window is measured from the click that started the
    // flight rather than from the card that opens some time after it.
    flightExpectedRef.current = { id: experienceId, at: performance.now() };
  }, []);

  // A window that outlives the list belongs to nobody.
  useEffect(() => () => {
    if (flightTimerRef.current) clearTimeout(flightTimerRef.current);
  }, []);

  return { handleCardOpened, measureRow, expectFlight };
}
