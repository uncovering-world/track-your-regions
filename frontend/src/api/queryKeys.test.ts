/**
 * What the key factory promises (#790): a family's prefix reaches every answer
 * in the family, and an answer that depends on who is asking is keyed on them.
 */

import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

describe('queryKeys', () => {
  it('puts every single answer under its family prefix', () => {
    const { experience, experiences, regions, discover, curation, visited, admin } = queryKeys;
    const pairs: [readonly unknown[], readonly unknown[]][] = [
      [experience.one(1), experience.all],
      [experience.locations(1), experience.locationsAll],
      [experience.contents(1), experience.contentsAll],
      [experience.curationLog(1), experience.curationLogAll],
      [experiences.byRegion(7, true), experiences.inRegion(7)],
      [experiences.inRegion(7), experiences.all],
      [experiences.regionLocations(7, false, true), experiences.regionLocationsIn(7)],
      [experiences.regionLocationsIn(7), experiences.regionLocationsAll],
      [regions.geometryAs(5, 'hull'), regions.geometry(5)],
      [regions.geometry(5), regions.geometryAll],
      [regions.members(5), regions.membersAll],
      [regions.subregions('root'), regions.subregionsAll],
      [discover.regionCounts(1, 2), discover.regionCountsAll],
      [curation.reviewQueue({ q: 'x' }, 0, 0, 0), curation.reviewQueueAll],
      [visited.experiences(3, 1), visited.experiencesAll],
      [visited.status(3, 1), visited.statusAll],
      [admin.syncLogs(0, 25), admin.syncLogsAll],
      [admin.wvImport.rematchStatus(9), admin.wvImport.rematchStatusAll],
    ];
    for (const [key, prefix] of pairs) expect(startsWith(key, prefix)).toBe(true);
  });

  it('keys an answer that depends on the caller on the caller', () => {
    expect(queryKeys.worldViews.forCaller(undefined)).toEqual(['worldViews', 'anon']);
    expect(queryKeys.worldViews.forCaller(3)).not.toEqual(queryKeys.worldViews.forCaller(4));
    expect(queryKeys.visited.experiences(3, 1)).not.toEqual(queryKeys.visited.experiences(4, 1));
    expect(queryKeys.visited.regions(null, 1)).toEqual(['visited-regions', 'anon', 1]);
  });

  it("reaches the editor's outlines from the refresh a finished computation sends", async () => {
    // A world view's computation rewrites every region's geometry; the refresh
    // it sends has to reach the outline the editor is showing, whatever mode.
    const client = new QueryClient();
    client.setQueryData(queryKeys.regions.geometryAs(5, 'hull'), {});
    await client.invalidateQueries({ queryKey: queryKeys.regions.geometryAll });
    expect(client.getQueryState(queryKeys.regions.geometryAs(5, 'hull'))?.isInvalidated).toBe(true);
  });
});
