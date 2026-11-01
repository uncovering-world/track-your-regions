import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { attachMoveDivisions } from './reviewQueueMoveDivisions.js';
import type { ReviewQueueItem } from '../../api/responses/reviewQueue.js';

const mockedQuery = vi.mocked(pool.query);

/** Kinabalu Park's held move and a part's move of Monte San Giorgio, as the queue serves them. */
function cards(): ReviewQueueItem[] {
  return [
    {
      id: 1, proposed: [
        { field: 'name', old: 'a', new: 'b' },
        { field: 'location', old: { lon: 116.43, lat: 6.35 }, new: { lon: 116.55, lat: 6.05 } },
      ],
    },
    {
      id: 2, proposed: [], proposed_parts: [{
        kind: 'locations', item: { name: 'Besano', ref: null },
        fields: [{ field: 'location', old: { lon: 8.9, lat: 45.88 }, new: { lon: 8.88, lat: 45.89 } }],
      }],
    },
  ] as unknown as ReviewQueueItem[];
}

beforeEach(() => mockedQuery.mockReset());

describe('attachMoveDivisions', () => {
  it('asks once for every move on the page, the stored point then the proposed one', async () => {
    mockedQuery.mockResolvedValue({ rows: [
      { i: 1, leaves: [10], name: 'Kota Belud', country: 'Malaysia' },
      { i: 2, leaves: [11], name: 'Ranau', country: 'Malaysia' },
      { i: 3, leaves: [20], name: 'Viggiù', country: 'Italy' },
      { i: 4, leaves: [20], name: 'Viggiù', country: 'Italy' },
    ] } as never);
    const items = cards();

    await attachMoveDivisions(items);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0][1]).toEqual([[116.43, 116.55, 8.9, 8.88], [6.35, 6.05, 45.88, 45.89]]);
    expect(items[0].proposed![1].divisions).toEqual({
      from: { name: 'Kota Belud', country: 'Malaysia' }, to: { name: 'Ranau', country: 'Malaysia' }, same: false,
    });
    expect(items[0].proposed![0].divisions).toBeUndefined();
    expect(items[1].proposed_parts![0].fields[0].divisions).toMatchObject({ same: true });
  });

  it('reads a point at sea as in no division, and never as the same', async () => {
    mockedQuery.mockResolvedValue({ rows: [
      { i: 1, leaves: [], name: null, country: null },
      { i: 2, leaves: [], name: null, country: null },
      { i: 3, leaves: [20], name: 'Viggiù', country: 'Italy' },
      { i: 4, leaves: [21], name: 'Besano', country: 'Italy' },
    ] } as never);
    const items = cards();

    await attachMoveDivisions(items);

    expect(items[0].proposed![1].divisions).toEqual({ from: null, to: null, same: false });
  });

  it('reads a point the source moved under contents, and a shared leaf as no crossing', async () => {
    // One component of a serial site moved by its source, its old point on a border two leaves share.
    mockedQuery.mockResolvedValue({ rows: [
      { i: 1, leaves: [30, 31], name: 'Ranau', country: 'Malaysia' },
      { i: 2, leaves: [31], name: 'Kota Belud', country: 'Malaysia' },
    ] } as never);
    const items = [{ id: 4, pending_points: [
      { id: 7, name: 'Summit', externalRef: null, latitude: 6.075, longitude: 116.558, replaces: { latitude: 6.08, longitude: 116.55 } },
      { id: 8, name: 'Gate', externalRef: null, latitude: 6.01, longitude: 116.54, replaces: null },
    ] }] as unknown as ReviewQueueItem[];

    await attachMoveDivisions(items);

    expect(mockedQuery.mock.calls[0][1]).toEqual([[116.55, 116.558], [6.08, 6.075]]);
    expect(items[0].pending_points![0].divisions).toMatchObject({ same: true });
    expect(items[0].pending_points![1].divisions).toBeUndefined();
  });

  it('asks nothing of a page with no coordinate move', async () => {
    await attachMoveDivisions([{ id: 3, proposed: [{ field: 'name', old: 'a', new: 'b' }] }] as unknown as ReviewQueueItem[]);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
