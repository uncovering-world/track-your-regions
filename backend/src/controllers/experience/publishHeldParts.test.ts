/**
 * Tests for publishing the held fields of an object's parts (ADR-0037).
 *
 * The held-proposal half of publishing, one level down: a place's name, a
 * work's attribution, picture and credit, kept out of rows readers can already
 * see and recorded in the changeset's contents record. Its own file beside
 * `publishController.test.ts`, which had reached the length the lint draws the
 * line at; the client and the helpers are shared through
 * `publishController.fixtures.ts`, so the two files describe one server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  // Mirrors the real one, returning the rollback's own failure — which is what
  // `client.release()` needs to destroy a client carrying an open transaction.
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

// Mocked as a module rather than through the pool: placement opens its own
// transaction on its own connection, so driving it through the fake client would
// prove nothing about whether it ran off this one.
vi.mock('../../services/sync/regionAssignmentService.js', () => ({
  worldViewsWithGeometry: vi.fn(async () => [1, 4]),
  assignRegionsForExperiences: vi.fn(async () => 3),
}));

import {
  grantScope, makeClient, mockedConnect, mockedQuery, none, noWrites, only, publish,
  type ProposedPart,
} from './publishController.fixtures.js';

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
});

/**
 * The held fields of an object's parts (ADR-0037): a place's name, a work's
 * attribution, picture and credit, kept out of rows readers can already see
 * and recorded in the changeset's contents record. Publishing is the one
 * writer that applies them, and what is worth pinning is the same set of
 * promises the object's held fields carry — the value comes from the run's own
 * record, a claim is skipped rather than refused, an unwritable field refuses
 * the whole call, the staleness check covers a proposal held on parts alone —
 * plus the two a part adds: the row is the one `partRecord.ts` resolves, locked,
 * and a part the record names that no row answers to is reported, not 409ed.
 */
describe('publishing the held fields of an object\'s parts', () => {
  const MONTSEGUR: ProposedPart = {
    item: { name: 'Château de Montésgur', ref: '1755-004' },
    fields: [{ field: 'name', old: 'Château de Montésgur', new: 'Château de Montségur', held: true }],
  };
  const MONTSEGUR_ROW = {
    id: 88, name: 'Château de Montésgur', ordinal: 4, curated_fields: [], latitude: 42.88, longitude: 1.83,
  };
  const OLD_FILE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Wine%20Glass.jpg';
  const NEW_FILE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Wine%20Glass%202.jpg';
  const NEW_CREDIT = { author: 'Someone Else', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null };
  const WINE_GLASS: ProposedPart = {
    item: { name: 'The Wine Glass', ref: 'Q782639' },
    fields: [
      { field: 'artist', old: 'Johannes Vermeer', new: 'Jan Vermeer van Haarlem the Elder', held: true },
      { field: 'image_url', old: OLD_FILE, new: NEW_FILE, held: true },
      { field: 'metadata.imageCredit', old: { author: 'Mbzt' }, new: NEW_CREDIT, held: true },
    ],
  };
  const WINE_GLASS_ROW = { id: 3102, name: 'The Wine Glass', curated_fields: [] };
  const HELD_ROW = { curation_state: 'verified', pending_change_sync_log_id: 64 };

  it('writes a held place name onto the row the record resolves to, locked', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: HELD_ROW,
      contents: { locations: { changed: [MONTSEGUR] } },
      parts: { location: MONTSEGUR_ROW },
    });

    const res = await publish({ expectedSyncLogId: 64 }, client);

    // Resolved and locked through the one rule the card resolves by, scoped to
    // this experience — a reference alone is duplicated on nine objects.
    const lock = only(queries, 'FROM experience_locations el');
    expect(lock.sql).toContain('FOR UPDATE');
    expect(lock.sql).toContain('el.experience_id = $1');
    expect(lock.params).toEqual([5, '1755-004', 'Château de Montésgur']);
    const write = only(queries, 'UPDATE experience_locations SET name');
    expect(write.params).toEqual([88, 'Château de Montségur']);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedParts: [{ kind: 'locations', name: 'Château de Montésgur', fields: ['name'], claimedFieldsSkipped: [] }],
    }));
    expect(JSON.parse(String(only(queries, 'INSERT INTO experience_curation_log').params[3])))
      .toMatchObject({ parts: [{ kind: 'locations', name: 'Château de Montésgur', fields: ['name'] }] });
  });

  it('writes a held work\'s attribution and picture with the credit the run fetched for it', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: HELD_ROW,
      contents: { treasures: { changed: [WINE_GLASS] } },
      parts: { treasure: WINE_GLASS_ROW },
    });

    const res = await publish({ expectedSyncLogId: 64 }, client);

    // Through this experience's own link, so a record naming a work another
    // venue holds writes nothing here.
    const lock = only(queries, 'FROM treasures t');
    expect(lock.sql).toContain('et.experience_id = $1');
    expect(lock.sql).toContain('FOR UPDATE');
    const write = only(queries, 'UPDATE treasures SET artist');
    expect(write.sql).toContain('image_url = $');
    // The credit rides with the picture: a hosted picture carries a credit, and
    // the next run is not the thing publishing this one.
    expect(write.sql).toContain("'imageCredit'");
    expect(write.sql).toContain('updated_at = NOW()');
    expect(write.params).toEqual([3102, 'Jan Vermeer van Haarlem the Elder', NEW_FILE, JSON.stringify(NEW_CREDIT)]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedParts: [{
        kind: 'treasures', name: 'The Wine Glass',
        fields: ['artist', 'image_url', 'metadata.imageCredit'], claimedFieldsSkipped: [],
      }],
    }));
  });

  it('leaves a part\'s field the curator has since claimed as they wrote it, and says so', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: HELD_ROW,
      contents: { treasures: { changed: [WINE_GLASS] } },
      parts: { treasure: { ...WINE_GLASS_ROW, curated_fields: ['artist'] } },
    });

    const res = await publish({ expectedSyncLogId: 64 }, client);

    // Skipped, not refused: whose attribution it is and whether readers may see
    // the rest are different questions, and both can be open at once.
    // Named by its first assignment: the object publish also passes the
    // museum's unread works with `UPDATE treasures SET curation_state`.
    const write = only(queries, 'UPDATE treasures SET image_url');
    expect(write.sql).not.toContain('artist =');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedParts: [expect.objectContaining({
        fields: ['image_url', 'metadata.imageCredit'], claimedFieldsSkipped: ['artist'],
      })],
    }));
  });

  it('refuses the whole call over a part field it cannot write, leaving the pointer standing', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: HELD_ROW,
      contents: { locations: { changed: [{
        item: MONTSEGUR.item,
        fields: [{ field: 'location', old: { lon: 1, lat: 42 }, new: { lon: 2, lat: 43 }, held: true }],
      }] } },
      parts: { location: MONTSEGUR_ROW },
    });

    const res = await publish({ expectedSyncLogId: 64 }, client);

    // A held coordinate cannot occur by construction — a kept row is within ten
    // metres, and a claimed one is the claim's — so this is the safety net the
    // object's own writer has: nothing held may be dropped in silence.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('location'),
      pendingChangeSyncLogId: 64,
    }));
    expect(noWrites(queries)).toBe(true);
  });

  it('applies the staleness check to a proposal held on parts alone', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: HELD_ROW,
      contents: { locations: { changed: [MONTSEGUR] } },
      parts: { location: MONTSEGUR_ROW },
    });

    // The card names the run; a caller naming nothing was shown nothing to
    // answer, and publishing would apply a value the curator never saw.
    const res = await publish({}, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ pendingChangeSyncLogId: 64 }));
    expect(noWrites(queries)).toBe(true);
  });

  it('writes the parts on a fields-only publish and never on a contents publish', async () => {
    grantScope();
    const fields = makeClient({
      row: HELD_ROW, contents: { locations: { changed: [MONTSEGUR] } }, parts: { location: MONTSEGUR_ROW },
    });
    await publish({ fieldsOnly: true, expectedSyncLogId: 64 }, fields.client);
    expect(only(fields.queries, 'UPDATE experience_locations SET name').params).toEqual([88, 'Château de Montségur']);
    expect(none(fields.queries, 'UPDATE experience_locations SET curation_state')).toBe(true);

    grantScope();
    const contents = makeClient({
      row: HELD_ROW, contents: { locations: { changed: [MONTSEGUR] } }, parts: { location: MONTSEGUR_ROW },
    });
    await publish({ contentsOnly: true }, contents.client);
    // A contents publish leaves the object's row, its pointer and its held
    // proposal exactly as they were — a part's held field is part of that.
    expect(none(contents.queries, 'UPDATE experience_locations SET name')).toBe(true);
    expect(none(contents.queries, 'FROM experience_locations el')).toBe(true);
  });

  it('reports a part the record names that no offered row answers to, and publishes the rest', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: HELD_ROW,
      contents: { locations: { changed: [MONTSEGUR] }, treasures: { changed: [WINE_GLASS] } },
      parts: { location: null, treasure: WINE_GLASS_ROW },
    });

    const res = await publish({ expectedSyncLogId: 64 }, client);

    // The source withdrew the place after proposing the rename: the row is
    // shown to nobody, so there is nothing to apply and nothing to refuse — and
    // 409ing would leave a card no answer can clear.
    expect(none(queries, 'UPDATE experience_locations SET name')).toBe(true);
    expect(only(queries, 'UPDATE treasures SET artist').params[0]).toBe(3102);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      partsNotFound: [{ kind: 'locations', name: 'Château de Montésgur' }],
      appliedParts: [expect.objectContaining({ kind: 'treasures' })],
    }));
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });
});
