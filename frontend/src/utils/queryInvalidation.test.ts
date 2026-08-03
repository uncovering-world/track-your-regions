/**
 * The location batch is the cache most easily forgotten, because nothing about
 * it looks like a list: it answers "where are the pins", not "what is here".
 * But it answers for exactly the rows the list is showing, so anything that
 * changes that set leaves it wrong — and its key carries `includeLost`, so
 * there are two entries to reach rather than one.
 */

import { describe, it, expect, vi } from 'vitest';
import { invalidateExperiences } from './queryInvalidation';

function makeClient() {
  const keys: unknown[][] = [];
  return {
    keys,
    client: {
      invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => { keys.push(queryKey); }),
    },
  };
}

describe('invalidateExperiences', () => {
  it('reaches the location batch for the region', () => {
    const { client, keys } = makeClient();

    invalidateExperiences(client as never, { regionId: 7 });

    expect(keys).toContainEqual(['region-locations', 7]);
  });

  it('stops at the region, so both lost variants of the key are covered', () => {
    const { client, keys } = makeClient();

    invalidateExperiences(client as never, { regionId: 7 });

    // The full key is ['region-locations', regionId, includeLost]. A key naming
    // the third element would invalidate one entry and leave its sibling to
    // answer the next question from the pre-correction set.
    const batch = keys.find(k => k[0] === 'region-locations');
    expect(batch).toHaveLength(2);
  });

  it('leaves it alone when no region is named', () => {
    const { client, keys } = makeClient();

    invalidateExperiences(client as never, { experienceId: 3 });

    expect(keys.some(k => k[0] === 'region-locations')).toBe(false);
  });
});
