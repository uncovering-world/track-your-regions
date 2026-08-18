/**
 * The location batch is the cache most easily forgotten, because nothing about
 * it looks like a list: it answers "where are the pins", not "what is here".
 * But it answers for exactly the rows the list is showing, so anything that
 * changes that set leaves it wrong — and its key carries `includeLost` and
 * `includeChildren`, so there are several entries to reach rather than one —
 * three with call sites today, and the prefix must not depend on which
 * combinations happen to have them.
 */

import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateExperiences, invalidateAfterBatchPublication } from './queryInvalidation';

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

  it('stops at the region, so every variant of the key is covered', () => {
    const { client, keys } = makeClient();

    invalidateExperiences(client as never, { regionId: 7 });

    // The full key is ['region-locations', regionId, includeLost, includeChildren]
    // — Map mode reads a region without its descendants under either
    // `includeLost`, Discover reads it with them. A key naming any of those
    // elements would invalidate one entry and leave the rest to answer the next
    // question from the pre-correction set.
    const batch = keys.find(k => k[0] === 'region-locations');
    expect(batch).toHaveLength(2);
  });

  it('marks every variant stale for real, and leaves another region alone', () => {
    // The assertion above proves the *shape* of the key we send. It cannot prove
    // the effect, because a captured call is not an invalidated cache — and the
    // effect is the whole point: the key stops at the region precisely to lean on
    // prefix matching. Asserted against a real client, so the guarantee is the
    // library's actual behaviour rather than our reading of it.
    const client = new QueryClient();
    // The three the app writes: Map mode's two `includeLost` variants without
    // descendants, and Discover's descendant-recursive one, which hardcodes
    // `includeLost: false`. The fourth combination is seeded too, because a
    // prefix must not depend on which combinations happen to have call sites.
    client.setQueryData(['region-locations', 7, false, false], ['pin']);
    client.setQueryData(['region-locations', 7, true, false], ['pin', 'lost pin']);
    client.setQueryData(['region-locations', 7, false, true], ['pin', 'descendant pin']);
    client.setQueryData(['region-locations', 7, true, true], ['pin', 'lost pin', 'descendant pin']);
    client.setQueryData(['region-locations', 8, false, false], ['another region']);

    invalidateExperiences(client, { regionId: 7 });

    expect(client.getQueryState(['region-locations', 7, false, false])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['region-locations', 7, true, false])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['region-locations', 7, false, true])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['region-locations', 7, true, true])?.isInvalidated).toBe(true);
    // The other half of "prefix": broad enough to catch every variant, narrow
    // enough that one region's edit does not refetch every region's pins.
    expect(client.getQueryState(['region-locations', 8, false, false])?.isInvalidated).toBe(false);
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

describe('invalidateAfterBatchPublication', () => {
  it('reaches every published object by prefix, and the pins with them', () => {
    const client = new QueryClient();
    client.setQueryData(['experience', 6206], { name: 'Prado' });
    client.setQueryData(['experience-locations', 6206], ['pin']);
    client.setQueryData(['experience-contents', 6206], ['work']);
    client.setQueryData(['region-locations', 7, false], ['pin']);

    invalidateAfterBatchPublication(client);

    // The object form deliberately reaches none of these without an id — a caller
    // who changed one object should say which. A batch changed a source's worth, so
    // the prefixes cover exactly what changed plus cheap extras, and cannot miss one
    // the way a list of 1272 ids can.
    for (const key of [
      ['experience', 6206], ['experience-locations', 6206],
      ['experience-contents', 6206], ['region-locations', 7, false],
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('reaches the audit log, which is where its one-row-per-object promise is read', () => {
    const client = new QueryClient();
    client.setQueryData(['curation-log', 6206], [{ action: 'published' }]);

    invalidateAfterBatchPublication(client);

    // "One `published` row per object, never one for the batch" is this endpoint's
    // headline decision, and this cache is where those rows are read. A batch that
    // wrote forty and left the log showing none would contradict itself on the first
    // object a curator opened.
    expect(client.getQueryState(['curation-log', 6206])?.isInvalidated).toBe(true);
  });

  it('clears the queue cards it just answered, from a screen that is not the queue', () => {
    const client = new QueryClient();
    client.setQueryData(['curation', 'reviewQueue', 0], { arrivals: [{ id: 1 }] });

    invalidateAfterBatchPublication(client);

    // The one publication path that does not start on the review page. Every verdict
    // taken *in* the queue invalidates this itself; a batch removes those cards in
    // bulk from the admin panel, and with `staleTime: 60000` and no refetch-on-focus
    // nothing else would recover them short of a reload.
    expect(client.getQueryState(['curation', 'reviewQueue', 0])?.isInvalidated).toBe(true);
  });

  it('still refetches the lists, since a released object joins them', () => {
    const client = new QueryClient();
    client.setQueryData(['experiences', 'by-region', 7, false], []);
    client.setQueryData(['discover-experiences'], []);

    invalidateAfterBatchPublication(client);

    expect(client.getQueryState(['experiences', 'by-region', 7, false])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['discover-experiences'])?.isInvalidated).toBe(true);
  });
});
