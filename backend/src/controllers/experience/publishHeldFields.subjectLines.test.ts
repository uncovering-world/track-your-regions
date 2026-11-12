/**
 * Publishing a run's two subject lines one at a time (#2476): each line is
 * reconciled against the other as the same proposal leaves it, so the order of
 * the two answers does not decide what the card says. Istanbul's Republic
 * Monument (Q1143790) is the case: run 919 proposed its dedication as Atatürk,
 * read from its memorials category, in place of the five people it depicts,
 * and the four others under *Depicts*. Published *Depicts* first, the four were
 * read as doubled by the dedication being replaced, and the line was lost.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The pairing drain opens a connection of its own, outside the fake client.
vi.mock('../../services/sync/mergeProposalFinder.js', () => ({
  drainPairing: vi.fn(async () => ({ places: 0, wholeCatalogue: false, open: 0, fromWikidata: 0 })),
}));

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

vi.mock('../../services/sync/regionAssignmentService.js', () => ({
  worldViewsWithGeometry: vi.fn(async () => [1, 4]),
  assignRegionsForExperiences: vi.fn(async () => 3),
}));

import { grantScope, makeClient, mockedConnect, mockedQuery, only, publish } from './publishController.fixtures.js';

// The five figures as Wikidata's depicts statements name them, read off run 919's change.
const subject = (item: string, label: string) => ({ item, label, articleUrl: null });
const ATATURK = subject('Q5152', 'Mustafa Kemal Atatürk');
const FOUR = [
  subject('Q2636506', 'Semyon Aralov'), subject('Q186185', 'Kliment Voroshilov'),
  subject('Q328331', 'Fevzi Çakmak'), subject('Q183297', 'İsmet İnönü'),
];
const OLD_DEDICATION = { via: 'depicts', subjects: [ATATURK, ...FOUR] };
const NEW_DEDICATION = { via: 'memorials-category', subjects: [ATATURK] };
const NEW_DEPICTS = { via: 'depicts', subjects: FOUR };

/** The place before the publish, and run 919's change of both lines. */
const republicMonument = (
  metadata: Record<string, unknown>, open: Array<'metadata.commemorates' | 'metadata.depicts'>, curated: string[] = [],
) => makeClient({
  row: { curation_state: 'verified', pending_change_sync_log_id: 53, metadata, curated_fields: curated },
  proposal: [
    { field: 'metadata.commemorates', old: OLD_DEDICATION, new: NEW_DEDICATION, held: true },
    { field: 'metadata.depicts', old: undefined, new: NEW_DEPICTS, held: true },
  ].filter(field => open.includes(field.field as never)),
});

const written = (queries: Array<{ sql: string; params: unknown[] }>) => {
  const update = only(queries, 'UPDATE experiences');
  const index = Number(/metadata = \$(\d+)/.exec(update.sql)![1]) - 1;
  return JSON.parse(String(update.params[index]));
};

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
});

describe('two subject lines published one at a time (#2476)', () => {
  it('keeps the depicted people when Depicts is published before the dedication that still names them changes', async () => {
    grantScope(6);
    const { client, queries } = republicMonument({ commemorates: OLD_DEDICATION }, ['metadata.commemorates', 'metadata.depicts']);

    await publish({ heldFields: ['metadata.depicts'], expectedSyncLogId: 53 }, client);

    // Read against the proposed dedication, Atatürk alone, none of the four is doubled.
    expect(written(queries)).toEqual({ commemorates: OLD_DEDICATION, depicts: NEW_DEPICTS });
  });

  it('leaves the same card in either order', async () => {
    grantScope(6);
    const first = republicMonument({ commemorates: OLD_DEDICATION }, ['metadata.commemorates', 'metadata.depicts']);
    await publish({ heldFields: ['metadata.commemorates'], expectedSyncLogId: 53 }, first.client);
    expect(written(first.queries)).toEqual({ commemorates: NEW_DEDICATION });

    grantScope(6);
    const second = republicMonument({ commemorates: NEW_DEDICATION }, ['metadata.depicts']);
    await publish({ heldFields: ['metadata.depicts'], expectedSyncLogId: 53 }, second.client);
    expect(written(second.queries)).toEqual({ commemorates: NEW_DEDICATION, depicts: NEW_DEPICTS });
  });

  it("reads a dedication a curator claimed as the curator's, not as the run proposes it", async () => {
    grantScope(6);
    // A curator kept the five as whom it commemorates: no publish writes that
    // line, so Depicts is cleared against it whether published alone or together.
    const curators = { via: 'curator', subjects: [ATATURK, ...FOUR] };
    const alone = republicMonument({ commemorates: curators }, ['metadata.commemorates', 'metadata.depicts'], ['metadata.commemorates']);
    await publish({ heldFields: ['metadata.depicts'], expectedSyncLogId: 53 }, alone.client);
    expect(written(alone.queries)).toEqual({ commemorates: curators });

    grantScope(6);
    const together = republicMonument({ commemorates: curators }, ['metadata.commemorates', 'metadata.depicts'], ['metadata.commemorates']);
    await publish({ heldFields: ['metadata.commemorates', 'metadata.depicts'], expectedSyncLogId: 53 }, together.client);
    expect(written(together.queries)).toEqual({ commemorates: curators });
  });

  it('still reads the dedication the place holds once its change is answered', async () => {
    grantScope(6);
    // The curator kept the old dedication: its change is no longer open, so
    // the published line is cleared of the people it names, as before.
    const { client, queries } = republicMonument({ commemorates: OLD_DEDICATION }, ['metadata.depicts']);

    await publish({ heldFields: ['metadata.depicts'], expectedSyncLogId: 53 }, client);

    expect(written(queries)).toEqual({ commemorates: OLD_DEDICATION });
  });
});
