import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorkKinds } from './useWorkKinds';

const KINDS = [
  { kind_id: 2, kind_name: 'Art Museums', type: null },
  { kind_id: 5, kind_name: 'Archaeology', type: 'museum' },
];
const WORKS = [{ id: 11, kind_ids: [2, 5] }, { id: 12, kind_ids: [2] }];

describe('useWorkKinds (#1263)', () => {
  it('starts each card over: another place opened the same way gets its own choice', () => {
    // The Capitoline Museums and, once merged, the Louvre: both in Art Museums
    // and Archaeology, both opened from Archaeology's list.
    const { result, rerender } = renderHook(
      ({ placeId }) => useWorkKinds(placeId, WORKS, KINDS, 5),
      { initialProps: { placeId: 6214 } },
    );
    act(() => result.current.toggle(2));
    expect(result.current.shown).toHaveLength(2);

    rerender({ placeId: 6187 });

    expect(result.current.shown.map(work => work.id)).toEqual([11]);
    expect(result.current.chips.find(chip => chip.kind.kind_id === 2)?.selected).toBe(false);
  });
});
