import { describe, it, expect } from 'vitest';
import {
  flattenGroups, expansionForSelection, rowIndexByExperienceId, experienceIdsAtIndices,
  experienceIdsInVisibleRange,
} from './utils';
import type { Experience } from '../../api/experiences';

const exp = (id: number, name = `E${id}`) => ({ id, name } as Experience);
const group = (categoryName: string, ids: number[]) => ({
  categoryName,
  experiences: ids.map(id => exp(id)),
});

/**
 * The three mechanisms windowing the experience list rests on.
 *
 * Measured on Europe before it, where the largest category holds 467 rows:
 * opening a region blocked the main thread for 2571 ms in a single task, 3839 ms
 * in total, and the page carried 9474 DOM nodes. Windowed, 18 rows are mounted at
 * a time, the longest task is 626 ms and the node count is 2639 (#552). None of
 * that is something a unit test can assert, so these guard the parts the
 * measurement rests on.
 */
describe('the windowed experience list', () => {
  describe('flattenGroups', () => {
    it('gives a collapsed group its header and nothing else', () => {
      // What `unmountOnExit` did before, arrived at differently: a collapsed
      // group contributes no rows, so the virtualiser never counts them.
      const rows = flattenGroups([group('UNESCO', [1, 2, 3])], new Set());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'header' });
    });

    it('gives an expanded group its header and every experience, in order', () => {
      const rows = flattenGroups([group('UNESCO', [1, 2, 3])], new Set(['UNESCO']));
      expect(rows.map(r => (r.kind === 'header' ? 'H' : r.exp.id))).toEqual(['H', 1, 2, 3]);
    });

    it('keeps the groups in the order it was given', () => {
      // The reader's sequence must not change because the rows are windowed:
      // groups arrive sorted by display priority and leave that way.
      const rows = flattenGroups(
        [group('UNESCO', [1]), group('Museums', [2]), group('Public Art', [3])],
        new Set(['UNESCO', 'Museums', 'Public Art']),
      );
      expect(rows.map(r => (r.kind === 'header' ? r.group.categoryName : r.exp.id)))
        .toEqual(['UNESCO', 1, 'Museums', 2, 'Public Art', 3]);
    });

    it('expands only the groups named, leaving the others as headers', () => {
      const rows = flattenGroups(
        [group('UNESCO', [1, 2]), group('Museums', [3, 4])],
        new Set(['Museums']),
      );
      expect(rows.map(r => (r.kind === 'header' ? r.group.categoryName : r.exp.id)))
        .toEqual(['UNESCO', 'Museums', 3, 4]);
    });
  });

  describe('rowIndexByExperienceId', () => {
    it('finds an experience by the row it occupies', () => {
      // This is what the list's movements ask instead of the DOM. A marker's
      // row is usually outside the window, so `itemRefs` holds no element for
      // it — before windowing that path existed and worked; after it, a hover
      // from the map would silently scroll nowhere without this.
      const rows = flattenGroups([group('UNESCO', [7, 8, 9])], new Set(['UNESCO']));
      const index = rowIndexByExperienceId(rows);
      expect(index.get(7)).toBe(1);
      expect(index.get(9)).toBe(3);
    });

    it('knows nothing of an experience whose group is collapsed', () => {
      // Correct rather than unfortunate: a collapsed row has no position to
      // scroll to, and the caller falls back to the element path.
      const rows = flattenGroups([group('UNESCO', [7])], new Set());
      expect(rowIndexByExperienceId(rows).has(7)).toBe(false);
    });
  });

  describe('experienceIdsAtIndices', () => {
    it('reports the experiences the window holds and skips its headers', () => {
      // What makes a New-badge impression honest once rows are windowed: the
      // server keeps the *first* impression, so a row the reader never scrolled
      // to would spend their personal window unseen. Before this the list
      // reported every experience of an expanded group — 467 of them — while
      // the reader had passed ten.
      const rows = flattenGroups([group('UNESCO', [1, 2, 3, 4])], new Set(['UNESCO']));
      expect(experienceIdsAtIndices(rows, [0, 1, 2])).toEqual([1, 2]);
    });

    it('ignores indices the list does not have', () => {
      // The virtualiser's items and the flat rows are recomputed in different
      // renders, and one commit can hold indices from the longer of the two.
      const rows = flattenGroups([group('UNESCO', [1])], new Set(['UNESCO']));
      expect(experienceIdsAtIndices(rows, [0, 1, 99])).toEqual([1]);
    });
  });

  describe('experienceIdsInVisibleRange', () => {
    const rows = flattenGroups([group('UNESCO', [1, 2, 3, 4, 5, 6])], new Set(['UNESCO']));

    it('leaves out the rows mounted only as overscan', () => {
      // The regression this guards: `getVirtualItems()` includes `overscan` rows
      // on either side of the viewport — mounted precisely because they are not
      // in view. Reporting them spends the reader's week on rows below the fold,
      // which is the same unrecoverable stamp windowing exists to stop, eight
      // rows at a time. `virtualizer.range` is the pre-overscan range.
      expect(experienceIdsInVisibleRange(rows, { startIndex: 2, endIndex: 4 })).toEqual([2, 3, 4]);
    });

    it('skips the headers inside the range', () => {
      expect(experienceIdsInVisibleRange(rows, { startIndex: 0, endIndex: 2 })).toEqual([1, 2]);
    });

    it('reports nothing before the first range is computed', () => {
      // `virtualizer.range` is null until the scroll element has been measured,
      // and a null range is "not yet known", never "the whole list".
      expect(experienceIdsInVisibleRange(rows, null)).toEqual([]);
    });

    it('stops at the end of the list when the range runs past it', () => {
      expect(experienceIdsInVisibleRange(rows, { startIndex: 5, endIndex: 40 })).toEqual([5, 6]);
    });
  });
});

/**
 * What the list opens by itself (#592).
 *
 * Two ways to be sent to a card and shown nothing, and this decides both. A
 * link to a card in a category that is not the first one — the list opened the
 * first group, always. And a card selected inside the region already open,
 * which is what a search result gives a reader already standing there: no
 * region change, so the once-per-region rule declined to fire at all.
 */
describe('what the list opens by itself', () => {
  const groups = [
    group('UNESCO World Heritage Sites', [1, 2, 3]),
    group('Art Museums', [10, 11]),
    group('Public Art & Monuments', [20]),
  ];
  const base = {
    groups,
    selectedExperienceId: null as number | null,
    expanded: new Set<string>(),
    openedForRegion: false,
    openedForCard: null as number | null,
  };

  it('opens the first group when a region arrives with no card named', () => {
    expect(expansionForSelection(base)?.open).toEqual(new Set(['UNESCO World Heritage Sites']));
  });

  it('opens the group holding the card the address named', () => {
    const decision = expansionForSelection({ ...base, selectedExperienceId: 11 });
    expect(decision?.open).toEqual(new Set(['Art Museums']));
    expect(decision?.forCard).toBe(11);
  });

  it('opens the holding group beside what the reader already has open', () => {
    // The reader is standing in the region and picks a search result of it: no
    // region change, so nothing resets, and the group they were reading must
    // not be closed to open the card's.
    const decision = expansionForSelection({
      ...base,
      selectedExperienceId: 11,
      expanded: new Set(['UNESCO World Heritage Sites']),
      openedForRegion: true,
    });
    expect(decision?.open).toEqual(new Set(['UNESCO World Heritage Sites', 'Art Museums']));
  });

  it('answers a card whose group is already open without writing anything', () => {
    const decision = expansionForSelection({
      ...base,
      selectedExperienceId: 2,
      expanded: new Set(['UNESCO World Heritage Sites']),
      openedForRegion: true,
    });
    expect(decision).not.toBeNull();
    expect(decision?.open).toBeNull();
    // Recorded even so: without it, the reader collapsing that group would be
    // overruled on the very next render.
    expect(decision?.forCard).toBe(2);
  });

  it('leaves a card it has already answered alone, so a collapse stands', () => {
    expect(expansionForSelection({
      ...base,
      selectedExperienceId: 11,
      expanded: new Set(['UNESCO World Heritage Sites']),
      openedForRegion: true,
      openedForCard: 11,
    })).toBeNull();
  });

  it('falls back to the first group for a card this region does not hold', () => {
    // The window between the region's rows arriving and the address dropping
    // the card: the reader must still be given a list rather than none.
    expect(expansionForSelection({ ...base, selectedExperienceId: 999 })?.open)
      .toEqual(new Set(['UNESCO World Heritage Sites']));
  });

  it('does nothing once a region has opened its group and no card asks', () => {
    expect(expansionForSelection({ ...base, openedForRegion: true })).toBeNull();
  });

  it('opens nothing where there is nothing to open', () => {
    expect(expansionForSelection({ ...base, groups: [], selectedExperienceId: 11 })).toBeNull();
  });
});
