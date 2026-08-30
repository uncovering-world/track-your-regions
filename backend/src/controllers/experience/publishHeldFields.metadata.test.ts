/**
 * Tests for the one column publishing cannot assign from a changeset entry.
 *
 * `metadata` is reported in parts — the keys a product decision hangs on
 * individually, the ones a curator claimed, and a catch-all for the rest — and
 * `nextMetadata` resolves them together. Its own file beside
 * `publishController.test.ts`, which had reached the length the lint draws the
 * line at, and beside `publishHeldParts.test.ts`, which left for the same
 * reason; the client and the helpers are shared through
 * `publishController.fixtures.ts`, so the three files describe one server.
 *
 * The rule worth pinning hardest is the credit's (#722): it is the credit of
 * the *stored picture*, which on this catalogue means the catch-all decides it
 * on 1413 of the 1414 cards that hold one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

// Placement opens its own transaction on its own connection, so driving it
// through the fake client would prove nothing; mocked as a module, as the two
// sibling files mock it.
vi.mock('../../services/sync/regionAssignmentService.js', () => ({
  worldViewsWithGeometry: vi.fn(async () => [1, 4]),
  assignRegionsForExperiences: vi.fn(async () => 3),
}));

import {
  grantScope, makeClient, mockedConnect, mockedQuery, none, only, publish,
} from './publishController.fixtures.js';

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
});

describe('the metadata column, which no single entry describes', () => {
  const heldMetadata = (old: unknown, next: unknown, row: Record<string, unknown>) => makeClient({
    row: { curation_state: 'auto', pending_change_sync_log_id: 53, ...row },
    proposal: [{ field: 'metadata', old, new: next, held: true }],
  });

  /**
   * The picture this call wrote, or undefined where it wrote none.
   *
   * Asserted beside the credit in every test that publishes `imageUrl`: these
   * are about what the credit does *when the picture lands*, and they would all
   * pass over a publication that never wrote it.
   */
  const picture = (queries: Array<{ sql: string; params: unknown[] }>) => {
    const update = only(queries, 'UPDATE experiences');
    const at = /image_url = \$(\d+)/.exec(update.sql);
    return at ? update.params[Number(at[1]) - 1] : undefined;
  };

  const written = (queries: Array<{ sql: string; params: unknown[] }>) => {
    const update = only(queries, 'UPDATE experiences');
    const index = Number(/metadata = \$(\d+)/.exec(update.sql)![1]) - 1;
    return JSON.parse(String(update.params[index]));
  };

  it('answers one metadata key and leaves the catch-all open', async () => {
    grantScope();
    // Bamiyan's real card: run 68 holds `metadata.inDanger` on its own row and
    // the criteria and the picture credit inside the catch-all, so the table
    // draws two answer cells and a curator can take the flag alone.
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        metadata: { inDanger: false, criteria: '(i)' },
      },
      proposal: [
        { field: 'metadata.inDanger', old: false, new: true, held: true },
        { field: 'metadata', old: { criteria: '(i)' }, new: { criteria: '(i)(ii)(iii)(iv)' }, held: true },
      ],
    });

    const res = await publish({ heldFields: ['metadata.inDanger'], expectedSyncLogId: 53 }, client);

    // The key this call names, and the catch-all's own keys left exactly as the
    // row holds them — `nextMetadata` sees no catch-all entry, so it starts from
    // what is stored rather than from what the run proposed for the rest.
    expect(written(queries)).toEqual({ inDanger: true, criteria: '(i)' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: ['metadata.inDanger'], heldLeftOpen: 1,
    }));
    expect(only(queries, 'UPDATE experiences').sql)
      .not.toContain('pending_change_sync_log_id = NULL');
  });

  it('writes a credit the run fetched for the picture the row already shows', async () => {
    grantScope();
    // The ordinary case, and the one a rule about the picture must not break:
    // 1413 of the 1414 cards holding a credit on this catalogue hold no picture
    // change at all — the run found the photographer for the photograph the page
    // has been showing all along, and publishing that change is what finally
    // names them (`data-assertions.md` § picture-with-nobody-credited). Deleting
    // it here would also mark the row answered, so no later run would offer it.
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        image_url: 'https://whc.unesco.org/document/141884',
        metadata: { criteria: '(x)' },
      },
      proposal: [{
        field: 'metadata',
        old: { criteria: '(x)' },
        new: { criteria: '(x)', imageCredit: { author: 'JUNG Mi-gyeong' } },
        held: true,
      }],
    });

    await publish({ expectedSyncLogId: 53 }, client);

    expect(written(queries)).toEqual({
      criteria: '(x)', imageCredit: { author: 'JUNG Mi-gyeong' },
    });
  });

  it('writes it too where the run offers the picture the row already has', async () => {
    grantScope();
    // The same shape one step on: a curator published the picture row earlier,
    // so the run still proposes it and the stored value already matches. The
    // credit beside it belongs to what the row shows.
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        image_url: 'https://whc.unesco.org/document/225476',
        metadata: {},
      },
      proposal: [
        { field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true },
        { field: 'metadata', old: {}, new: { imageCredit: { author: 'JUNG Mi-gyeong' } }, held: true },
      ],
    });

    await publish({ heldFields: ['metadata'], expectedSyncLogId: 53 }, client);

    expect(written(queries)).toEqual({ imageCredit: { author: 'JUNG Mi-gyeong' } });
  });

  it('drops a stale credit where the picture lands and the run drops the key', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        image_url: 'https://whc.unesco.org/document/141884',
        metadata: { imageCredit: { author: 'The old photograph’s' } },
      },
      proposal: [
        { field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true },
        // The run says something about metadata and that something has no
        // credit in it — the source stopped shipping one for this picture.
        { field: 'metadata', old: { imageCredit: { author: 'The old photograph’s' } }, new: {}, held: true },
      ],
    });

    await publish({ expectedSyncLogId: 53 }, client);

    // No credit beats the previous photographer's name under a photograph they
    // did not take — a false statement about a real person is worse than a gap.
    expect(picture(queries)).toBe('https://whc.unesco.org/document/225476');
    expect(written(queries)).toEqual({});
  });

  it('keeps the credit where the run proposes no metadata row at all', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        image_url: 'https://whc.unesco.org/document/141884',
        metadata: { imageCredit: { author: 'JUNG Mi-gyeong' } },
      },
      proposal: [{ field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true }],
    });

    await publish({ expectedSyncLogId: 53 }, client);

    // `computeChangeSet` emits the catch-all only where the two stripped
    // objects differ, so a run with no metadata row is *asserting* the stored
    // metadata — the same photographer for the new picture. Reading the absent
    // row as "no credit offered" would delete a credit the run stands behind,
    // on every call that publishes a picture.
    expect(picture(queries)).toBe('https://whc.unesco.org/document/225476');
    expect(none(queries, 'metadata = ')).toBe(true);
  });

  it('writes nobody where the curator refused the credit and published the picture', async () => {
    grantScope();
    // Two clicks a curator can really make: "not this" on the source data, then
    // "publish this" on the photograph. Writing the refused credit would make
    // refusing write something, which is the one thing it must never do; keeping
    // the stored one would name the photographer of a picture nobody is shown.
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        image_url: 'https://whc.unesco.org/document/141884',
        metadata: { imageCredit: { author: 'The old photograph’s' } },
      },
      proposal: [
        { field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true },
        {
          field: 'metadata',
          old: { imageCredit: { author: 'The old photograph’s' } },
          new: { imageCredit: { author: 'JUNG Mi-gyeong' } },
          held: true,
        },
      ],
      answered: [{ kind: null, ref: null, name: null, field: 'metadata', answer: 'refused' }],
    });

    await publish({ heldFields: ['imageUrl'], expectedSyncLogId: 53 }, client);

    // Nobody credited, which `picture-with-nobody-credited` reports so somebody
    // goes and fetches one — under the new photograph, which really did land.
    expect(picture(queries)).toBe('https://whc.unesco.org/document/225476');
    expect(written(queries)).toEqual({});
  });

  it('finishes the credit the earlier publication had to hold back', async () => {
    grantScope();
    // The two clicks in the other order. Publishing the source data first, while
    // the picture row was open and offering a different photograph, wrote the
    // *stored* credit deliberately — the row was still showing the old picture.
    // "Published" is therefore no evidence that the column holds the run's
    // credit, and reading it that way left the new photograph credited to the
    // previous photograph's author, permanently: both rows answered, the pointer
    // gone, and the answer recorded by value so no run re-offers it.
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        image_url: 'https://whc.unesco.org/document/141884',
        metadata: { criteria: '(x)', imageCredit: { author: 'The old photograph’s' } },
      },
      proposal: [
        { field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true },
        {
          field: 'metadata',
          old: { criteria: '(x)', imageCredit: { author: 'The old photograph’s' } },
          new: { criteria: '(ix)(x)', imageCredit: { author: 'JUNG Mi-gyeong' } },
          held: true,
        },
      ],
      answered: [{ kind: null, ref: null, name: null, field: 'metadata', answer: 'published' }],
    });

    await publish({ heldFields: ['imageUrl'], expectedSyncLogId: 53 }, client);

    // The picture lands and its credit lands with it. The criteria are the
    // catch-all's and are not written here: that row is answered, so only the
    // one key the pin speaks for moves.
    expect(picture(queries)).toBe('https://whc.unesco.org/document/225476');
    expect(written(queries)).toEqual({
      criteria: '(x)', imageCredit: { author: 'JUNG Mi-gyeong' },
    });
  });

  it('takes the credit with the picture, and only with it', async () => {
    grantScope();
    // Getbol's card: run 68 proposes a new photograph and the credit UNESCO
    // ships beside it, as two answerable rows — `imageUrl` on its own and
    // `imageCredit` inside the source-data catch-all. Publishing the picture
    // alone used to leave the credit naming the previous photograph's author.
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        metadata: { criteria: '(x)', imageCredit: { author: 'Someone Else' } },
      },
      proposal: [
        { field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true },
        {
          field: 'metadata',
          old: { criteria: '(x)', imageCredit: { author: 'Someone Else' } },
          new: { criteria: '(ix)(x)', imageCredit: { author: 'JUNG Mi-gyeong' } },
          held: true,
        },
      ],
    });

    const res = await publish({ heldFields: ['imageUrl'], expectedSyncLogId: 53 }, client);

    // The picture, and the credit that belongs to it — but not the criteria,
    // which are a different fact and were not answered.
    expect(picture(queries)).toBe('https://whc.unesco.org/document/225476');
    expect(written(queries)).toEqual({
      criteria: '(x)', imageCredit: { author: 'JUNG Mi-gyeong' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: ['imageUrl'], heldLeftOpen: 1,
    }));
  });

  it('keeps the stored credit where the picture is not published', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        metadata: { criteria: '(x)', imageCredit: { author: 'Someone Else' } },
      },
      proposal: [
        { field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true },
        {
          field: 'metadata',
          old: { criteria: '(x)', imageCredit: { author: 'Someone Else' } },
          new: { criteria: '(ix)(x)', imageCredit: { author: 'JUNG Mi-gyeong' } },
          held: true,
        },
      ],
    });

    await publish({ heldFields: ['metadata'], expectedSyncLogId: 53 }, client);

    // The other direction, and the worse of the two on the ground: a credit
    // naming the photographer of a picture nobody is shown is a false statement
    // about a real person.
    expect(written(queries)).toEqual({
      criteria: '(ix)(x)', imageCredit: { author: 'Someone Else' },
    });
  });

  it('leaves a claimed credit alone even where the picture lands', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        curated_fields: ['metadata.imageCredit'],
        metadata: { imageCredit: { author: 'The curator’s own' } },
      },
      proposal: [
        { field: 'imageUrl', new: 'https://whc.unesco.org/document/225476', held: true },
        {
          field: 'metadata', old: {}, new: { imageCredit: { author: 'JUNG Mi-gyeong' } }, held: true,
        },
      ],
    });

    await publish({ heldFields: ['imageUrl'], expectedSyncLogId: 53 }, client);

    // A curator who claimed the credit on its own has answered this already —
    // `editExperience` claims it where the edit put a value in it — and their
    // value wins over the rule that ties it to the picture.
    expect(written(queries)).toEqual({ imageCredit: { author: 'The curator’s own' } });
  });

  it('applies a key the source dropped', async () => {
    grantScope();
    const { client, queries } = heldMetadata({ a: 1, website: 'w' }, { a: 1 }, { metadata: { a: 1, website: 'w' } });

    await publish({ expectedSyncLogId: 53 }, client);

    // Recorded only by its absence from `new`. Merged with `||` it would survive,
    // the run would propose the same removal every time, and this endpoint would
    // clear the pointer without ever applying it.
    expect(written(queries)).toEqual({ a: 1 });
  });

  it('keeps a key the diff reported on its own', async () => {
    grantScope();
    const { client, queries } = heldMetadata({ a: 1 }, { a: 2 }, { metadata: { inDanger: true, a: 1 } });

    await publish({ expectedSyncLogId: 53 }, client);

    // `computeChangeSet` strips `inDanger` out of both sides before diffing the
    // rest, so the catch-all is not speaking for it — and assigning the
    // catch-all's `new` would delete a UNESCO site's danger listing.
    expect(written(queries)).toEqual({ inDanger: true, a: 2 });
  });

  it('gives a per-key claim back to the curator', async () => {
    grantScope();
    const { client, queries } = heldMetadata(
      { a: 1, website: 'curated' }, { a: 1, website: 'from-the-source' },
      { metadata: { a: 1, website: 'curated' }, curated_fields: ['metadata.website'] },
    );

    await publish({ expectedSyncLogId: 53 }, client);

    // A claim made after the run cannot be filtered out of the proposal: the key
    // is inside the catch-all, under the field name 'metadata'. So it is
    // re-applied from what is stored, exactly as the upsert re-applies it.
    expect(written(queries)).toEqual({ a: 1, website: 'curated' });
  });
});
