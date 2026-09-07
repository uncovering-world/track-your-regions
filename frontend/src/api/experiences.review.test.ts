/**
 * `fetchReviewQueue` writes the review page's address (`ReviewAddress`) — plus
 * the cursor and the two offsets the answered lists still page by — into the
 * exact query words `reviewQueueQuerySchema` reads (ADR-0051): `sort, q,
 * source, kind, region, run, aside, cursor, limit, keptOutOffset,
 * answeredWithdrawalsOffset`. `row` is the address's own field for the
 * selected card; the API does not read it, so it is never sent.
 *
 * `setRunAside` / `bringRunBack` are the two set-aside calls, a PUT and a
 * DELETE on the same run id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchReviewQueue, setRunAside, bringRunBack } from './experiences';
import { EMPTY_REVIEW, type ReviewAddress } from '../utils/appUrl';

describe('fetchReviewQueue', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes a full address as the exact query the backend schema reads', async () => {
    const address: ReviewAddress = {
      q: 'memorial',
      sort: 'question',
      sourceIds: [1, 3],
      kinds: ['arrival', 'refused'],
      regionId: 'none',
      runId: 98,
      showAside: true,
      // The selected row — carried by the address for a deep link, not a
      // request parameter. Included here precisely so its absence below is
      // proof the query-building code drops it, not that the test forgot it.
      row: 'waiting:11586',
    };

    await fetchReviewQueue({ ...address, cursor: 'abc', limit: 50, keptOutOffset: 25 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/experiences/review/queue');
    // `URLSearchParams` percent-encodes the comma in `source`/`kind` (`,` →
    // `%2C`), so the raw query string is asserted directly rather than the
    // parsed `URLSearchParams` object, which would decode it back to `,` and
    // hide that detail.
    expect(url.search).toBe(
      '?sort=question&q=memorial&source=1%2C3&kind=arrival%2Crefused&region=none'
      + '&run=98&aside=show&cursor=abc&limit=50&keptOutOffset=25',
    );
    expect(url.search).not.toContain('row');
  });

  it('sends no filter params at all for an empty address', async () => {
    await fetchReviewQueue(EMPTY_REVIEW);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/experiences/review/queue');
    expect(url.search).toBe('');
  });
});

describe('setRunAside / bringRunBack', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ syncLogId: 98, setAside: true }),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setRunAside PUTs the run id', async () => {
    await setRunAside(98);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/experiences/review/set-aside/98');
    expect((init as RequestInit).method).toBe('PUT');
  });

  it('bringRunBack DELETEs the run id', async () => {
    await bringRunBack(98);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/experiences/review/set-aside/98');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
