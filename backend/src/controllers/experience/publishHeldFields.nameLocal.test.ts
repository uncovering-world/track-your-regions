/**
 * Tests for the second column publishing cannot assign from a changeset entry.
 *
 * A run records each local name that differs on its own — `nameLocal.ko`,
 * `nameLocal.en` — since #728, so six languages are six answerable rows over one
 * jsonb column. `nextNameLocal` is what makes those answers mean anything:
 * publishing the Korean name merges it onto the map as the row holds it, leaving
 * the five nobody answered exactly as readers see them. Assigned, one answer
 * would write the run's whole map and take the other five with it, which is the
 * defect the per-row shape exists to remove.
 *
 * A card filed before that change carries the older shape — one `nameLocal`
 * entry holding the whole map — and stands until a run re-proposes (ADR-0039
 * decision 4), so both are live and both are here. Its own file beside
 * `publishHeldFields.metadata.test.ts` for the reason that one left
 * `publishController.test.ts`: one server, three files, the client and the
 * helpers shared through `publishController.fixtures.ts`.
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
  type Proposed,
} from './publishController.fixtures.js';

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
});

describe('the local names, which no single entry describes', () => {
  /** Getbol's card as a run files it now: a language per entry, held by the gate. */
  const held = (stored: Record<string, string> | null, proposal: Proposed[]) => makeClient({
    row: { curation_state: 'auto', pending_change_sync_log_id: 53, name_local: stored },
    proposal,
  });

  const written = (queries: Array<{ sql: string; params: unknown[] }>) => {
    const update = only(queries, 'UPDATE experiences');
    const index = Number(/name_local = \$(\d+)/.exec(update.sql)![1]) - 1;
    return JSON.parse(String(update.params[index]));
  };

  // Two of Getbol's six, and used alphabetically below because that is the order
  // a run files them in: a jsonb column does not keep the order the keys went
  // in, so the diff and the card both sort.
  const ENGLISH = {
    field: 'nameLocal.en',
    old: 'Getbol, Korean Tidal Flats (Phase II)',
    new: 'Getbol, Korean Tidal Flats',
    held: true,
  };
  const KOREAN = { field: 'nameLocal.ko', old: '한국의 갯벌', new: '한국의 갯벌 (2단계)', held: true };

  it('writes the language answered and leaves the others as readers see them', async () => {
    grantScope();
    // The whole of #728 in one call. A curator takes the corrected Korean name;
    // the English one they have no view on stays what the page shows, and stays
    // a question. Assigned rather than merged, this write would have carried the
    // run's `en` too — the answer covering a fact nobody gave it about.
    const { client, queries } = held(
      { ko: '한국의 갯벌', en: 'Getbol, Korean Tidal Flats (Phase II)', fr: 'Getbol' },
      [ENGLISH, KOREAN],
    );

    const res = await publish({ heldFields: ['nameLocal.ko'], expectedSyncLogId: 53 }, client);

    expect(res.status).not.toHaveBeenCalled();
    expect(written(queries)).toEqual({
      ko: '한국의 갯벌 (2단계)',
      en: 'Getbol, Korean Tidal Flats (Phase II)',
      fr: 'Getbol',
    });
    // And the English row is still waiting, which is what keeps the pointer and
    // brings the card back with that one row on it.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: ['nameLocal.ko'], heldLeftOpen: 1,
    }));
    expect(only(queries, 'UPDATE experiences').sql).not.toContain('pending_change_sync_log_id = NULL');
  });

  it('drops a language the source stopped publishing', async () => {
    grantScope();
    // A removal is recorded only by the entry having no value, so a merge that
    // kept what it does not mention would leave the run proposing the same
    // removal for ever and this endpoint applying it never.
    const { client, queries } = held(
      { en: 'Getbol', fr: 'Getbol' },
      [{ field: 'nameLocal.fr', old: 'Getbol', new: undefined, held: true }],
    );

    await publish({ heldFields: ['nameLocal.fr'], expectedSyncLogId: 53 }, client);

    expect(written(queries)).toEqual({ en: 'Getbol' });
  });

  it('adds a language to a row that had none', async () => {
    grantScope();
    const { client, queries } = held(
      null,
      [{ field: 'nameLocal.ko', old: undefined, new: '한국의 갯벌', held: true }],
    );

    await publish({ expectedSyncLogId: 53 }, client);

    expect(written(queries)).toEqual({ ko: '한국의 갯벌' });
  });

  it('answering every entry comes to the map the run itself would have written', async () => {
    grantScope();
    // The property that makes merging safe: a curator who takes all of it gets
    // what the upsert would have written past the gate, removals included. Said
    // as a whole-card publish, which names no rows at all.
    const { client, queries } = held(
      { ko: '한국의 갯벌', en: 'Getbol, Korean Tidal Flats (Phase II)', fr: 'Getbol' },
      [ENGLISH, { field: 'nameLocal.fr', old: 'Getbol', new: undefined, held: true }, KOREAN],
    );

    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(written(queries)).toEqual({
      ko: '한국의 갯벌 (2단계)', en: 'Getbol, Korean Tidal Flats',
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ heldLeftOpen: 0 }));
  });

  it('leaves the column alone where the run says nothing about it', async () => {
    grantScope();
    const { client, queries } = held(
      { en: 'Getbol' },
      [{ field: 'name', old: 'Old', new: 'New', held: true }],
    );

    await publish({ expectedSyncLogId: 53 }, client);

    expect(none(queries, 'name_local = ')).toBe(true);
  });

  it('gives a claimed column back to the curator, every language of it', async () => {
    grantScope();
    // `name_local` is claimed whole — the upsert's guard is `curated_fields ?
    // 'name_local'`, and no editor writes one language — so the claim covers
    // every entry under it. `claimKeyFor`'s family lookup is what reaches them;
    // without it each `nameLocal.<lang>` would name itself, match no claim, and
    // be written straight over the curator's map.
    const { client, queries } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        curated_fields: ['name_local'], name_local: { ko: 'the curator’s' },
      },
      proposal: [ENGLISH, KOREAN],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(none(queries, 'name_local = ')).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: [],
      claimedFieldsSkipped: ['nameLocal.en', 'nameLocal.ko'],
    }));
  });

  describe('a card filed before a run recorded one language at a time', () => {
    it('replaces the column wholesale from the map the entry carries', async () => {
      grantScope();
      // Such an entry named the whole column on both sides, so what it proposes
      // *is* the map — and a merge that kept a stored language its `old`
      // mentions would put back one the source dropped. The shape is live
      // because a changeset is what happened and is never rewritten.
      const { client, queries } = held(
        { en: 'Getbol, Korean Tidal Flats (Phase II)', fr: 'Getbol' },
        [{
          field: 'nameLocal',
          old: { en: 'Getbol, Korean Tidal Flats (Phase II)', fr: 'Getbol' },
          new: { en: 'Getbol, Korean Tidal Flats', ko: '한국의 갯벌' },
          held: true,
        }],
      );

      await publish({ heldFields: ['nameLocal'], expectedSyncLogId: 53 }, client);

      expect(written(queries)).toEqual({ en: 'Getbol, Korean Tidal Flats', ko: '한국의 갯벌' });
    });

    it('writes an empty map where the source stopped publishing local names', async () => {
      grantScope();
      // `null` on the proposal's own side, which the merge reads as the entry
      // speaking for everything its `old` names and offering nothing back.
      const { client, queries } = held(
        { en: 'Getbol' },
        [{ field: 'nameLocal', old: { en: 'Getbol' }, new: null, held: true }],
      );

      await publish({ expectedSyncLogId: 53 }, client);

      expect(written(queries)).toEqual({});
    });
  });
});
