import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/sync/regionAssignmentService.js', () => ({ regionsHoldingPoints: vi.fn() }));

import { regionsHoldingPoints } from '../../services/sync/regionAssignmentService.js';
import { attachRegionCrossings } from './reviewQueueRegionCrossings.js';
import type { ReviewQueueItem } from '../../api/responses/reviewQueue.js';

const mockedPlaced = vi.mocked(regionsHoldingPoints);

const ADMIN = { worldViewId: 5, worldView: 'Administrative' };
const VOYAGE = { worldViewId: 2, worldView: 'Wikivoyage Regions' };
const hit = (pointId: number, view: typeof ADMIN, regionId: number, region: string) => ({ pointId, ...view, regionId, region });

/**
 * Comoé National Park's held move as the development catalogue held it on
 * 2026-11-02, which leaves Savanes for Zanzan in the Administrative hierarchy,
 * and a serial site's component moved by its source under contents.
 */
function cards(): ReviewQueueItem[] {
  return [
    {
      id: 1, proposed: [
        { field: 'name', old: 'a', new: 'b' },
        { field: 'location', old: { lon: -4, lat: 9 }, new: { lon: -3.758, lat: 9.077 } },
      ],
    },
    {
      id: 2, pending_points: [
        { id: 7, name: 'Gate', externalRef: null, latitude: 8.5, longitude: -3.6, replaces: { latitude: 8.51, longitude: -3.61 } },
        { id: 8, name: 'New', externalRef: null, latitude: 8.4, longitude: -3.5, replaces: null },
      ],
    },
  ] as unknown as ReviewQueueItem[];
}

beforeEach(() => mockedPlaced.mockReset());

describe('attachRegionCrossings', () => {
  it('asks once for every move on the page and names each hierarchy whose leaf the move changes', async () => {
    mockedPlaced.mockResolvedValue([
      hit(1, ADMIN, 10, 'Savanes'), hit(1, VOYAGE, 50, 'West Africa'),
      hit(2, ADMIN, 11, 'Zanzan'), hit(2, VOYAGE, 50, 'West Africa'),
      hit(3, ADMIN, 11, 'Zanzan'), hit(4, ADMIN, 11, 'Zanzan'),
    ]);
    const items = cards();

    await attachRegionCrossings(items);

    // Every move's two points, placed at once by the run's own placement.
    expect(mockedPlaced).toHaveBeenCalledTimes(1);
    expect(mockedPlaced.mock.calls[0][0]).toEqual([
      { id: 1, lon: -4, lat: 9 }, { id: 2, lon: -3.758, lat: 9.077 },
      { id: 3, lon: -3.61, lat: 8.51 }, { id: 4, lon: -3.6, lat: 8.5 },
    ]);
    // Administrative changes; Wikivoyage keeps the place in West Africa.
    expect(items[0].proposed![1].regionCrossings).toEqual([{ worldView: 'Administrative', from: 'Savanes', to: 'Zanzan' }]);
    expect(items[0].proposed![0].regionCrossings).toBeUndefined();
    // A moved point that stays in its leaf crosses nothing; an added point is no move.
    expect(items[1].pending_points![0].regionCrossings).toEqual([]);
    expect(items[1].pending_points![1].regionCrossings).toBeUndefined();
  });

  it('names a move out of a hierarchy\'s regions, as Aegospotami\'s old point at sea comes into one', async () => {
    mockedPlaced.mockResolvedValue([hit(2, ADMIN, 11, 'Çanakkale')]);
    const items = cards();

    await attachRegionCrossings(items);

    expect(items[0].proposed![1].regionCrossings).toEqual([{ worldView: 'Administrative', from: null, to: 'Çanakkale' }]);
  });

  it('reads a point on the border of two regions, which holds both, as no crossing', async () => {
    mockedPlaced.mockResolvedValue([
      hit(1, ADMIN, 10, 'Savanes'), hit(1, ADMIN, 11, 'Zanzan'), hit(2, ADMIN, 11, 'Zanzan'),
    ]);
    const items = cards();

    await attachRegionCrossings(items);

    expect(items[0].proposed![1].regionCrossings).toEqual([]);
  });

  it('asks nothing of a page with no coordinate move', async () => {
    await attachRegionCrossings([{ id: 3, proposed: [{ field: 'name', old: 'a', new: 'b' }] }] as unknown as ReviewQueueItem[]);
    expect(mockedPlaced).not.toHaveBeenCalled();
  });
});
