import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInViewFilter } from './useInViewFilter';
import type { ViewBounds } from '../../utils/viewBounds';
import type { Experience } from '../../api/experiences';

/** Nothing folded, which is every case here but the fold's own test. */
const EMPTY: ReadonlySet<number> = new Set<number>();

const exp = (id: number, longitude: number, latitude: number, category = 'UNESCO') =>
  ({ id, name: `E${id}`, longitude, latitude, category_name: category } as Experience);

const PRAGUE: ViewBounds = { west: 14.35, south: 50.05, east: 14.50, north: 50.11 };
/** Two in Prague, one in Paris, one in Vienna. */
const REGION = [exp(1, 14.42, 50.087), exp(2, 2.35, 48.85), exp(3, 14.40, 50.09), exp(4, 16.37, 48.21)];

const render = (bounds: ViewBounds | null, regionId: number | null = 7, selected: number | null = null) =>
  renderHook(
    (props: { bounds: ViewBounds | null; regionId: number | null; selected: number | null }) =>
      useInViewFilter(REGION, {}, props.bounds, props.regionId, props.selected, EMPTY),
    { initialProps: { bounds, regionId, selected } },
  );

describe('useInViewFilter', () => {
  it('lists what the view holds, and counts what it hides', () => {
    const { result } = render(PRAGUE);
    expect(result.current.listedExperiences.map(e => e.id)).toEqual([1, 3]);
    expect(result.current.outsideView).toBe(2);
    expect(result.current.isFiltered).toBe(true);
  });

  it('lists the whole region while the map has not said what it shows', () => {
    // Null bounds is "no view to answer about" — a surface with no map, or the
    // render before the first `moveend`. A reader without a map keeps their list.
    const { result } = render(null);
    expect(result.current.listedExperiences).toHaveLength(4);
    expect(result.current.outsideView).toBe(0);
    expect(result.current.isFiltered).toBe(false);
  });

  it('gives the region back when the reader asks, and takes the ask back', () => {
    const { result } = render(PRAGUE);
    act(() => result.current.toggleWholeRegion());
    expect(result.current.listedExperiences).toHaveLength(4);
    expect(result.current.showWholeRegion).toBe(true);
    // …and the count stays true about the view, because it is what the notice
    // offers to hide again.
    expect(result.current.outsideView).toBe(2);
    expect(result.current.isFiltered).toBe(false);

    act(() => result.current.toggleWholeRegion());
    expect(result.current.listedExperiences.map(e => e.id)).toEqual([1, 3]);
  });

  it('does not carry the ask into another region', () => {
    // The same shape as `showLost`: the ask answers "let me see the rest of *this*
    // place". Stored as a flag it would follow the reader into the next region and
    // silently disable the filter there.
    const { result, rerender } = render(PRAGUE);
    act(() => result.current.toggleWholeRegion());
    expect(result.current.showWholeRegion).toBe(true);

    rerender({ bounds: PRAGUE, regionId: 8, selected: null });
    expect(result.current.showWholeRegion).toBe(false);
    expect(result.current.listedExperiences.map(e => e.id)).toEqual([1, 3]);
  });

  it('keeps the open row listed after the map drifts off it', () => {
    // Otherwise a pan closes what the reader is in the middle of reading, and the
    // row carries the only control that takes them back to it.
    const { result } = render(PRAGUE, 7, 2);
    expect(result.current.listedExperiences.map(e => e.id)).toEqual([1, 2, 3]);
  });

  it('does not count the open row as hidden while it is listed', () => {
    // Both halves of the same sentence: the exempted row is on the page, so the
    // notice must not offer to bring it back. Of the four in this region, 2 and 4
    // are out of view and 2 is open — one genuinely hidden row remains.
    const { result } = render(PRAGUE, 7, 2);
    expect(result.current.outsideView).toBe(1);
  });

  it('still reports what the view hides while the whole region is shown', () => {
    // The count is what the second click offers to hide again, so it must survive
    // the first one — derived from the view, not from the rows on screen.
    const { result } = render(PRAGUE);
    act(() => result.current.toggleWholeRegion());
    expect(result.current.outsideView).toBe(2);
  });

  it('reports each category’s whole-region total, not the view’s', () => {
    const { result } = renderHook(() => useInViewFilter(
      [exp(1, 14.42, 50.087, 'UNESCO'), exp(2, 2.35, 48.85, 'UNESCO'), exp(3, 14.40, 50.09, 'Museums')],
      {}, PRAGUE, 7, null, EMPTY,
    ));
    expect(result.current.totalByCategory.get('UNESCO')).toBe(2);
    expect(result.current.totalByCategory.get('Museums')).toBe(1);
    expect(result.current.listedExperiences.map(e => e.id)).toEqual([1, 3]);
  });
});
