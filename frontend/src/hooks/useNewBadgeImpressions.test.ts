/**
 * The rule this hook has to keep is "report what rendered", and the two ways
 * to break it are reporting rows nobody saw and reporting the same row twice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../api/experiences', () => ({
  markNewBadgesSeen: vi.fn().mockResolvedValue({ recorded: [] }),
}));

import { markNewBadgesSeen } from '../api/experiences';
import { useNewBadgeImpressions } from './useNewBadgeImpressions';

const mocked = markNewBadgesSeen as unknown as ReturnType<typeof vi.fn>;

const NEW_ROW = { id: 1, is_new: true };
const OLD_ROW = { id: 2, is_new: false };

describe('useNewBadgeImpressions', () => {
  beforeEach(() => {
    mocked.mockReset();
    mocked.mockResolvedValue({ recorded: [] });
  });

  it('reports only the rows carrying a chip', () => {
    renderHook(() => useNewBadgeImpressions([NEW_ROW, OLD_ROW], true));

    expect(mocked).toHaveBeenCalledWith([1]);
  });

  it('says nothing when there is no chip to report', () => {
    renderHook(() => useNewBadgeImpressions([OLD_ROW], true));

    expect(mocked).not.toHaveBeenCalled();
  });

  it('says nothing for a reader there is nobody to remember', () => {
    // Anonymous readers get the category window and no personal one, so an
    // impression has nowhere to go and the endpoint would 401
    renderHook(() => useNewBadgeImpressions([NEW_ROW], false));

    expect(mocked).not.toHaveBeenCalled();
  });

  it('does not re-send on a re-render with the same rows', () => {
    const { rerender } = renderHook(
      ({ rows }) => useNewBadgeImpressions(rows, true),
      { initialProps: { rows: [NEW_ROW] } },
    );

    rerender({ rows: [{ ...NEW_ROW }] });

    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('reports a row it has not seen before, on a later render', () => {
    const { rerender } = renderHook(
      ({ rows }) => useNewBadgeImpressions(rows, true),
      { initialProps: { rows: [NEW_ROW] } },
    );

    rerender({ rows: [NEW_ROW, { id: 3, is_new: true }] });

    expect(mocked).toHaveBeenNthCalledWith(2, [3]);
  });

  it('starts fresh for the next reader, who never unmounted the list', () => {
    // Logging in is a dialog, not a route: nothing unmounts the list when the
    // identity changes. Keeping one set across that would filter B's first
    // report down to nothing, and since only the first impression is kept,
    // B's own week on those rows could never start.
    const { rerender } = renderHook(
      ({ reader }) => useNewBadgeImpressions([NEW_ROW], true, reader),
      { initialProps: { reader: 1 } },
    );

    rerender({ reader: 2 });

    expect(mocked).toHaveBeenNthCalledWith(2, [1]);
  });

  it('keeps quiet when the call fails, and does not retry into a spin', async () => {
    mocked.mockRejectedValue(new Error('offline'));

    const { rerender } = renderHook(
      ({ rows }) => useNewBadgeImpressions(rows, true),
      { initialProps: { rows: [NEW_ROW] } },
    );
    rerender({ rows: [{ ...NEW_ROW }] });

    // Marked before the call, so a failure costs one impression rather than
    // producing a request per render forever
    expect(mocked).toHaveBeenCalledTimes(1);
  });
});
