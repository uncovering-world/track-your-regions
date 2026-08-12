/**
 * The location batch is the cache most easily forgotten, because nothing about
 * it looks like a list: it answers "where are the pins", not "what is here".
 * But it answers for exactly the rows the list is showing, so anything that
 * changes that set leaves it wrong — and its key carries `includeLost`, so
 * there are two entries to reach rather than one.
 */

import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
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

  it('marks both variants stale for real, and leaves another region alone', () => {
    // The assertion above proves the *shape* of the key we send. It cannot prove
    // the effect, because a captured call is not an invalidated cache — and the
    // effect is the whole point: the key stops at the region precisely to lean on
    // prefix matching. Asserted against a real client, so the guarantee is the
    // library's actual behaviour rather than our reading of it.
    const client = new QueryClient();
    client.setQueryData(['region-locations', 7, false], ['pin']);
    client.setQueryData(['region-locations', 7, true], ['pin', 'lost pin']);
    client.setQueryData(['region-locations', 8, false], ['another region']);

    invalidateExperiences(client, { regionId: 7 });

    expect(client.getQueryState(['region-locations', 7, false])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['region-locations', 7, true])?.isInvalidated).toBe(true);
    // The other half of "prefix": broad enough to catch both variants, narrow
    // enough that one region's edit does not refetch every region's pins.
    expect(client.getQueryState(['region-locations', 8, false])?.isInvalidated).toBe(false);
  });

  it("reaches the object's own points and works, which a publication is about", () => {
    const { client, keys } = makeClient();

    invalidateExperiences(client as never, { experienceId: 42 });

    // These two hold exactly what publishing releases, and `experience-contents`
    // keeps it for five minutes (`staleTime: 300000`). Without them a curator who
    // published twelve paintings reads "12 works now visible" and then opens the
    // object — via the card's own "Look at the object" — onto the list from
    // before. The notice would be right and the page would contradict it.
    expect(keys).toContainEqual(['experience-locations', 42]);
    expect(keys).toContainEqual(['experience-contents', 42]);
  });

  it('reaches every region\'s pins when the caller cannot name a region', () => {
    // What the curation queue does: it publishes an object and knows no region,
    // so the pins it just released sit in caches it cannot name. The list would
    // refetch anyway — `['experiences']` prefix-matches the by-region key — and a
    // list that gained a museum next to a map that did not is the visible half
    // of this bug.
    const client = new QueryClient();
    client.setQueryData(['region-locations', 7, false], ['pin']);
    client.setQueryData(['region-locations', 8, true], ['another region']);

    invalidateExperiences(client, { experienceId: 42 });

    expect(client.getQueryState(['region-locations', 7, false])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['region-locations', 8, true])?.isInvalidated).toBe(true);
  });

  it('stays narrow when the caller does name a region', () => {
    // The other side of the same rule: a region-scoped edit knows exactly which
    // batch it invalidated, so it must not refetch every other region's pins.
    const client = new QueryClient();
    client.setQueryData(['region-locations', 7, false], ['pin']);
    client.setQueryData(['region-locations', 8, false], ['another region']);

    invalidateExperiences(client, { regionId: 7, experienceId: 42 });

    expect(client.getQueryState(['region-locations', 7, false])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['region-locations', 8, false])?.isInvalidated).toBe(false);
  });

  it('leaves it alone when nothing is named', () => {
    // This assertion used to be made of `{ experienceId: 3 }`, and it was the bug
    // written down as a rule: an object whose points just changed invalidates
    // pins in regions the caller cannot enumerate. "No region named" is not the
    // condition — "nothing named" is, and then there is nothing to invalidate.
    const { client, keys } = makeClient();

    invalidateExperiences(client as never);

    expect(keys.some(k => k[0] === 'region-locations')).toBe(false);
  });
});
