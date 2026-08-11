/**
 * Tests for curator lifecycle decisions.
 *
 * The rules worth pinning are the ones a reader cannot infer from the column
 * names: every verdict clears `missing_since` (including "false alarm", which
 * changes nothing else), accepting a source value has to release the curator's
 * claim or the next run refuses it again, and a region-scoped curator may only
 * act on experiences their scope reaches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  // Mirrors the real one, returning the rollback's own failure — which is
  // what `client.release()` needs to destroy a client carrying an open
  // transaction. A stub that swallowed it would make that untestable.
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

// Mocked as a module rather than through the pool: placement opens its own
// transaction on its own connection, so driving it through the fake client
// would prove nothing about whether it ran off this one — the same reason
// `publishController.test.ts` mocks it this way.
vi.mock('../../services/sync/regionAssignmentService.js', () => ({
  worldViewsWithGeometry: vi.fn(async () => [1, 4]),
  assignRegionsForExperiences: vi.fn(async () => 3),
}));

import { pool } from '../../db/index.js';
import {
  getReviewQueue, setExperienceState, setExperienceAdmission, acceptSourceValue,
} from './lifecycleController.js';
import { CHANGESET_LANDED_SQL, ORPHANED_RUN_ERROR } from '../../services/sync/syncLogMarkers.js';
import { assignRegionsForExperiences } from '../../services/sync/regionAssignmentService.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedPlace = assignRegionsForExperiences as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };
const ADMIN = { id: 1, role: 'admin' as const };

/**
 * Captures what a transaction ran, so assertions can read the statements.
 *
 * `claimed` answers the `FOR UPDATE` re-read: the accept path reads
 * `curated_fields` inside its own transaction rather than trusting a value
 * fetched before the lock.
 */
function makeClient(claimed?: string[], state?: Record<string, unknown>, proposal?: unknown[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('experience_sync_changes')) return { rows: proposal ?? [] };
        if (sql.includes('FOR UPDATE')) {
          // Default to a realistic row: the locked read always carries these
          // columns in production, and a mock without them would let a test
          // pass while the handler wrote NULL into an axis nobody decided.
          return { rows: [{
            curated_fields: claimed ?? [],
            source_membership: 'present',
            existence: 'extant',
            missing_since: new Date('2026-08-03T10:00:00Z'),
            ...(state ?? {}),
          }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    },
  };
}

describe('getReviewQueue', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('asks separately for the rows this category refused', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // An answered refusal is pinned, and the pin is what takes it out of the
    // open list — in both directions, so a confirmed row does not reappear
    // here either. It reappears in the kept-out list below, which is a
    // different thing: not a question, just the only way back.
    const [refusedSql] = callMatching("NOT COALESCE(e.curated_fields ? 'admission', false)");
    expect(refusedSql).toContain("e.admission = 'refused'");
  });

  it('asks for the confirmed refusals too, since nothing else can show them', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // Every read hides a refused row and none of them takes a toggle, so a
    // confirmed refusal is invisible everywhere else. Without this query the
    // "put it back" button has nowhere to live and one click is permanent.
    const [keptOutSql] = callMatching("'kept-out' AS kind");
    expect(keptOutSql).toContain("e.admission = 'refused'");
    expect(keptOutSql).toContain("COALESCE(e.curated_fields ? 'admission', false)");
    expect(keptOutSql).not.toContain("NOT COALESCE(e.curated_fields ? 'admission', false)");
  });

  it('returns the confirmed refusals under their own key', async () => {
    const res = makeRes();
    mockedQuery.mockImplementation(async (sql: string) => (
      String(sql).includes("'kept-out' AS kind")
        ? { rows: [{ id: 6205, name: 'British Museum', admission_reason: 'not an art museum' }] }
        : { rows: [] }
    ));

    await getReviewQueue({ user: ADMIN, query: {} } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      keptOut: [expect.objectContaining({ name: 'British Museum' })],
      refused: [],
    }));
  });

  it('keeps a refused row out of the gone-from-the-source list', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // The same row under both headings would ask two contradictory questions,
    // and only one of them has a true answer.
    const [missingSql] = callMatching('missing_since IS NOT NULL');
    expect(missingSql).toContain("e.admission <> 'refused'");
  });

  it('returns the refusals as their own group, with the reason on them', async () => {
    const res = makeRes();
    mockedQuery.mockImplementation(async (sql: string) => (
      String(sql).includes("e.admission = 'refused'")
        ? { rows: [{ id: 6205, name: 'British Museum', admission_reason: 'not an art museum' }] }
        : { rows: [] }
    ));

    await getReviewQueue({ user: ADMIN, query: {} } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      refused: [expect.objectContaining({ admission_reason: 'not an art museum' })],
    }));
  });

  it('limits a curator to experiences their scope reaches', async () => {
    await getReviewQueue({ user: CURATOR, query: {} } as never, makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('curator_scoped_regions');
    expect(sql).toContain('experience_regions');
  });

  it('does not scope an admin, who covers everything', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).not.toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');
  });

  it('asks only for rows a run flagged and nobody has judged yet', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    // A row already moved to 'former' has been decided; it is not a question
    expect(sql).toContain('missing_since IS NOT NULL');
    expect(sql).toContain("source_membership = 'present'");
  });

  it('binds no parameter the SQL does not reference', async () => {
    // Postgres cannot infer a type for a placeholder that appears in the
    // parameter list but in no expression, and refuses the statement outright.
    // A mocked pool cannot see that, so assert the property that causes it.
    for (const query of [{}, { categoryId: 2 }]) {
      mockedQuery.mockClear();
      await getReviewQueue({ user: CURATOR, query } as never, makeRes() as never);

      for (const [sql, params] of mockedQuery.mock.calls as Array<[string, unknown[]]>) {
        for (let i = 1; i <= params.length; i++) {
          expect(String(sql)).toContain(`$${i}`);
        }
      }
    }
  });

  it('measures a category curator against each row, whether or not they filtered', async () => {
    // Correlating on any bound parameter would compare every row against the
    // caller's optional filter, so a category curator who did not filter would
    // lose the scope they hold. Both request shapes, since the filter changes
    // the numbering: with no categoryId the binds are userId, limit, offset.
    for (const query of [{}, { categoryId: 2 }]) {
      mockedQuery.mockClear();
      await getReviewQueue({ user: CURATOR, query } as never, makeRes() as never);

      const sql = String(mockedQuery.mock.calls[0][0]);
      expect(sql).toContain('ca.category_id = e.category_id');
      expect(sql).not.toMatch(/ca\.category_id = \$\d/);
    }
  });

  /**
   * The call that ran a given statement, found by a fragment unique to it.
   *
   * Positional indexing broke the moment a third query joined the two: the
   * conflicts read moved from calls[1] to calls[2] and six tests failed for a
   * reason unrelated to what any of them was checking.
   *
   * The conflicts tests below anchor on `'conflict' AS kind`, not on
   * `q.proposed IS NOT NULL` as they once did: `held` carries that same guard
   * now, so `.find()` would silently return whichever of the two happens to
   * run first — these tests passed for the wrong reason (call order) until
   * that ambiguity was found in review, not because the anchor was unique.
   */
  function callMatching(fragment: string): [string, unknown[]] {
    const found = mockedQuery.mock.calls.find(c => String(c[0]).includes(fragment));
    if (!found) throw new Error(`no query contained ${fragment}`);
    return [String(found[0]), found[1] as unknown[]];
  }

  it('drops a conflict once the field is no longer claimed', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // Accepting the source releases the claim but leaves the changeset row as
    // the record of what the run did — the claim is what makes it a question
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toContain('e.curated_fields ?');
    expect(conflictSql).toContain('q.proposed IS NOT NULL');
  });

  it('translates the changeset field name to the key curated_fields holds', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // 'shortDescription' is claimed as 'short_description', and
    // 'metadata.inDanger' as plain 'metadata' — not a mechanical case change
    const [, conflictParams] = callMatching("'conflict' AS kind");
    const map = JSON.parse(String(conflictParams.at(-4)));
    expect(map.shortDescription).toBe('short_description');
    expect(map['metadata.inDanger']).toBe('metadata');
  });

  it('drops a conflict a later run stopped proposing', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // A run that finds the source agreeing writes no changeset row at all, so
    // the absence of a newer conflict proves nothing. last_seen_sync_log_id is
    // what such a run does leave behind.
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toContain('last_seen_sync_log_id');
  });

  it('waits for the later run to finish before reading anything into it', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // last_seen is stamped per item inside the loop; the changeset lands in one
    // batch after it. Mid-run the newer value exists and the rows it would be
    // read against do not, so every conflict would vanish for the whole run.
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toContain('prev.completed_at IS NOT NULL');
  });

  it('reads nothing into a run that closed without recording anything', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // Status cannot answer this: a run that throws after the item loop records
    // its changes and only then marks itself failed. The markers can.
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toContain('"externalId":"changeset"');
    expect(conflictSql).toContain(ORPHANED_RUN_ERROR);
    expect(conflictSql).not.toContain("prev.status <> 'failed'");
  });

  it('still reads a run that failed after recording its batch', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // recordSyncFailure writes the changes and *then* marks the log failed, so
    // keying on status would suppress the inference for a run whose changeset
    // is entirely on record — resurfacing a conflict the source withdrew
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).not.toMatch(/prev\.status/);
  });

  it('ignores conflicts that only a preview proposed', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toContain('l.is_dry_run = FALSE');
  });

  /**
   * Anchor fragments unique to each of the three newer kinds, and to
   * `missing`'s new predicate. `held` and `conflicts` both contain
   * `q.proposed IS NOT NULL`, which is exactly the sibling-satisfies-the-
   * assertion trap the review of the previous task's branch found — so each
   * anchor here is text only its own query carries.
   */
  const QUEUE_KIND_ANCHOR = {
    arrival: "e.curation_state = 'pending'",
    missing: 'e.missing_since IS NOT NULL',
    held: 'e.pending_change_sync_log_id IS NOT NULL',
    contents: "el.curation_state = 'pending'",
  } as const;

  async function capturedQueueSql(
    kind: keyof typeof QUEUE_KIND_ANCHOR,
    user: typeof ADMIN | typeof CURATOR = ADMIN,
  ): Promise<string> {
    mockedQuery.mockClear();
    await getReviewQueue({ user, query: {} } as never, makeRes() as never);
    const [sql] = callMatching(QUEUE_KIND_ANCHOR[kind]);
    return sql;
  }

  it('offers an arrival only where it is answerable', async () => {
    const sql = await capturedQueueSql('arrival');
    expect(sql).toContain("e.curation_state = 'pending'");
    // A refused row is already invisible for a reason with its own card
    // (§ 2.3): asking "may readers see this?" about it asks the second
    // question first.
    expect(sql).toContain("e.admission <> 'refused'");
    // A row the source has stopped offering has no verdict to give (§ 3.6).
    expect(sql).toContain('e.missing_since IS NULL');
    // Without the scope filter a region curator is shown work they cannot open.
    expect(sql).toContain('curator_scoped_regions');
  });

  it('raises no missing card for a row no reader ever saw', async () => {
    // ADR-0025 § 3.6: nobody has seen this row yet, so there is no verdict
    // to give about whether it disappeared from in front of anyone.
    expect(await capturedQueueSql('missing')).toContain("e.curation_state <> 'pending'");
  });

  it('names the run whose proposal is held, and drops a card with nothing in it', async () => {
    const sql = await capturedQueueSql('held');
    expect(sql).toContain('e.pending_change_sync_log_id IS NOT NULL');
    expect(sql).toContain('ch.sync_log_id = e.pending_change_sync_log_id');
    // jsonb_agg over an empty set returns NULL, and an empty card is worse than none.
    expect(sql).toMatch(/WHERE q\.proposed IS NOT NULL/);
  });

  it('excludes a refused row from the held card', async () => {
    // Already invisible for its own reason (§ 2.3) — the held proposal is not
    // the question to ask about a row this category has turned down.
    const sql = await capturedQueueSql('held');
    expect(sql).toContain("e.admission <> 'refused'");
  });

  it('excludes a row the source has stopped listing from the held card', async () => {
    // That is `missing`'s question, and a row can be visible, flagged
    // missing_since, and holding a proposal all at once — asking both would
    // put the same row under two contradictory cards.
    const sql = await capturedQueueSql('held');
    expect(sql).toContain('e.missing_since IS NULL');
  });

  it('holds only the fields the gate refused, not a field a claim already refused', async () => {
    // The pointer is set for *any* refused proposal (syncUtils.ts's
    // proposedAnything), a curator's own claim included — so without this
    // filter a claimed field would carry both a `conflicts` card (answerable)
    // and a `held` twin (not), and the twin would outlive an `accept-source`
    // answer to the first.
    const sql = await capturedQueueSql('held');
    expect(sql).toContain("NOT (f->>'curatedConflict')::boolean");
  });

  it('does not offer an acceptable flag on a held field', async () => {
    // 'acceptable' is the conflict path's concept — accept-source's own
    // lookup requires a curatedConflict:true field, which held's now
    // deliberately excludes, so a true flag here would advertise a button
    // that always 409s.
    const sql = await capturedQueueSql('held');
    expect(sql).not.toContain('acceptable');
  });

  it('raises no contents card for a row the source has stopped listing', async () => {
    // The same row under two headings would ask two questions whose answers
    // contradict each other: "may readers see these twelve works?" is not
    // answerable while "did this venue disappear?" is open. `arrivals` and
    // `held` both carry this guard; `contents` was the one that did not.
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain('e.missing_since IS NULL');
  });

  it('counts a visible experience holding unread locations, and only unread ones', async () => {
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain("e.curation_state <> 'pending'"); // an arrival is the other card
    // Anchored on the JOIN clause itself, not just the predicate text: the
    // same fragment also appears in the FILTER, so a naive `.toContain` on
    // the predicate alone stays green even if this JOIN's own copy is
    // deleted — the exact trap the previous task's review found, now inside
    // one statement instead of across two.
    expect(sql).toMatch(
      /LEFT JOIN experience_locations el\s+ON el\.experience_id = e\.id AND el\.curation_state = 'pending' AND el\.missing_since IS NULL/,
    );
  });

  it('does not count a withdrawn pending point as unread', async () => {
    // A point the source has stopped offering is not "unread" in any sense a
    // reader would notice: every reader-facing location read already carries
    // offeredLocationSql(), so publishing it changes nothing on screen.
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain('el.missing_since IS NULL');
  });

  it('counts a treasure held by either its link or the work itself', async () => {
    // A link's curation_state and its treasure's are independent axes
    // (ADR-0025): a work is checked once, globally, a link "as being HERE".
    // getExperienceTreasures gates both separately, and this count has to
    // ask the same two questions or a treasure whose link was reviewed while
    // the shared work was not would be invisible and unasked-about forever.
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain('LEFT JOIN treasures t ON t.id = et.treasure_id');
    // Anchored on the FILTER clause specifically, not the predicate text
    // alone — the identical fragment also appears in the row-inclusion
    // WHERE, which would otherwise let this pass even with the FILTER's own
    // copy deleted (the same trap the JOIN-anchored location test guards
    // against, one clause over).
    expect(sql).toContain(
      "FILTER (WHERE et.curation_state = 'pending' OR t.curation_state = 'pending') AS pending_treasures",
    );
  });

  it('counts locations and treasures distinctly, not as their cross product', async () => {
    // el and et are independent one-to-many joins on the same experience, so
    // their combined row count is a product: 3 pending points and 12
    // pending works join to 36 raw rows, and a plain COUNT without DISTINCT
    // would report 36 for a treasure count that is really 12.
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain('COUNT(DISTINCT el.id)');
    expect(sql).toContain('COUNT(DISTINCT et.treasure_id)');
  });

  it('excludes a refused row from the contents card', async () => {
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain("e.admission <> 'refused'");
  });

  it('names the category and external id on all three new kinds, like the older four do', async () => {
    // An arrival names an object without naming which gated source it
    // arrived from, and "which source is this" is most of the judgement.
    for (const kind of ['arrival', 'held', 'contents'] as const) {
      const sql = await capturedQueueSql(kind);
      expect(sql).toContain('e.external_id');
      expect(sql).toContain('c.name AS category_name');
    }
  });

  it('limits a curator to what their scope reaches, for each of the three new kinds', async () => {
    // The weak `curator_scoped_regions` check above is satisfied by the CTE
    // prelude alone, which every query carries whether or not it is actually
    // scoped — so the real assertion is the JOIN a curator's request adds,
    // mirroring 'limits a curator to experiences their scope reaches' above.
    for (const kind of ['arrival', 'held', 'contents'] as const) {
      const sql = await capturedQueueSql(kind, CURATOR);
      expect(sql).toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');
    }
  });

  it('returns the three new kinds under their own response keys', async () => {
    const res = makeRes();
    mockedQuery.mockImplementation(async (sql: string) => (
      String(sql).includes("e.curation_state = 'pending'")
        ? { rows: [{ id: 42, name: 'A newly-arrived museum' }] }
        : { rows: [] }
    ));

    await getReviewQueue({ user: ADMIN, query: {} } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      arrivals: [expect.objectContaining({ id: 42, name: 'A newly-arrived museum' })],
      held: [],
      contents: [],
    }));
  });
});

describe('setExperienceState', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('refuses a call that decides nothing', async () => {
    const res = makeRes();

    await setExperienceState({ user: CURATOR, params: { id: '5' }, body: { expected: { membership: 'present', existence: 'extant', flagged: true } } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('answers 404 for an experience that does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await setExperienceState(
      { user: CURATOR, params: { id: '5' }, body: { membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('refuses a curator whose scope does not reach the experience', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await setExperienceState(
      { user: CURATOR, params: { id: '5' }, body: { membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('clears missing_since on every verdict, including a false alarm', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    // "present" over an already-present row: the source hiccupped, nothing moved
    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'present', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      makeRes() as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(update?.sql).toContain('missing_since = NULL');
  });

  it('records both decisions when one call carries both axes', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'former', existence: 'lost', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      makeRes() as never,
    );

    const actions = queries
      .filter(q => q.sql.includes('experience_curation_log'))
      .map(q => q.params[2]);
    expect(actions).toEqual(['marked_former', 'marked_lost']);
  });

  it('refuses a decision made about a state that is no longer stored', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    // Another curator answered `former` between this card being drawn and clicked
    const { client, queries } = makeClient(undefined, { source_membership: 'former', existence: 'extant' });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { existence: 'lost', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    // Writing here would take `source_membership` from a row this curator
    // never saw — and, on the mirror case, revert the verdict outright
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
  });

  it('refuses a card whose question a later run withdrew', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    // The source listed the object again, so the upsert cleared the flag and
    // left both axes exactly as the card rendered them
    const { client, queries } = makeClient(undefined, { source_membership: 'present', existence: 'extant', missing_since: null });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    // Taking it would record as delisted an object the source currently
    // lists, and no detection predicate would ever raise it again
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('Someone else answered'),
    }));
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
  });

  it('allows a correction made with the current state in view', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'former', existence: 'extant' }] });
    // No flag: this is a decided row, reached from a view that shows it
    const { client, queries } = makeClient(undefined, { source_membership: 'former', existence: 'extant', missing_since: null });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'present', expected: { membership: 'former', existence: 'extant', flagged: false } } } as never,
      res as never,
    );

    // Refusing every decided row would make `former` and `lost` terminal:
    // detection re-flags neither, so a mis-click could never be taken back
    const actions = queries.filter(q => q.sql.includes('experience_curation_log')).map(q => q.params[2]);
    expect(actions).toEqual(['state_restored']);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  it('takes the lock before writing the verdict', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient(undefined, { source_membership: 'present', existence: 'extant' });
    mockedConnect.mockResolvedValue(client);

    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      makeRes() as never,
    );

    expect(queries[0].sql).toBe('BEGIN');
    expect(queries[1].sql).toContain('FOR UPDATE');
    expect(queries.findIndex(q => q.sql.includes('UPDATE experiences'))).toBeGreaterThan(1);
  });

  it('refuses a verdict another curator already recorded', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    // Both curators had the same flagged card open; the other clicked first
    const { client, queries } = makeClient(undefined, { source_membership: 'present', existence: 'lost', missing_since: null });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { existence: 'lost', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    // Logging the fallback here would enter this curator as having dismissed
    // the flag as a false alarm, which is the opposite of what they said
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('experience_curation_log'))).toBe(false);
    expect(queries.some(q => q.sql === 'ROLLBACK')).toBe(true);
  });

  it('still records a false alarm the curator did assert', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient(undefined, { source_membership: 'present', existence: 'extant' });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // Nothing moves here either, but saying "it never went anywhere" is a
    // verdict, and it is the one that clears the flag
    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'present', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    const actions = queries.filter(q => q.sql.includes('experience_curation_log')).map(q => q.params[2]);
    expect(actions).toEqual(['missing_dismissed']);
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  it('refuses a stale verdict that would undo another curator\'s answer', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    // A answered `former`, which cleared the flag. B's card predates that.
    const { client, queries } = makeClient(undefined, { source_membership: 'former', existence: 'extant', missing_since: null });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // "False alarm" over a recorded `former` is a real transition, so no check
    // on the verdict alone catches it: only comparing what B was looking at
    // with what is stored does
    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'present', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
  });

  it('refuses a decision on a question that was never open', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient(undefined, { missing_since: null });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // The caller describes the row exactly as it is — unflagged — so the
    // `expected` comparison passes and this reaches the branch beyond it.
    // Asserting the message, not just the status, is what keeps the two 409s
    // apart: with `flagged: true` here the test would pass on the wrong gate.
    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'present', expected: { membership: 'present', existence: 'extant', flagged: false } } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('not waiting on a decision'),
    }));
    expect(queries.some(q => q.sql.includes('experience_curation_log'))).toBe(false);
  });

  it('reaches the same verdict from the other axis', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient();
    mockedConnect.mockResolvedValue(client);

    // `existence: 'extant'` on an extant row is the same assertion made about
    // the other axis: nothing moved, and the curator said so
    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { existence: 'extant', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      makeRes() as never,
    );

    const actions = queries.filter(q => q.sql.includes('experience_curation_log')).map(q => q.params[2]);
    expect(actions).toEqual(['missing_dismissed']);
  });

  it('destroys the client when a refusal path cannot roll back either', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient();
    client.query.mockImplementation(async (sql: string) => {
      queries.push({ sql, params: [] });
      if (sql === 'ROLLBACK') throw new Error('rollback failed too');
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ curated_fields: [], source_membership: 'former', existence: 'extant', missing_since: null }] };
      }
      return { rows: [] };
    });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // A 409 leaves through `finally` like everything else, so dropping the
    // helper's result here pools a client whose transaction never closed
    await setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('destroys a client whose rollback also failed, rather than pooling it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient();
    client.query.mockImplementation(async (sql: string) => {
      queries.push({ sql, params: [] });
      if (sql === 'ROLLBACK') throw new Error('rollback failed too');
      if (sql.includes('experience_curation_log')) throw new Error('log write failed');
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ curated_fields: [], source_membership: 'present', existence: 'extant', missing_since: new Date('2026-08-03T10:00:00Z') }] };
      }
      return { rows: [] };
    });
    mockedConnect.mockResolvedValue(client);

    await expect(setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      makeRes() as never,
    )).rejects.toThrow('log write failed');

    // pg-pool keeps a released client unless the argument is truthy or the
    // connection has already gone unqueryable, so one whose ROLLBACK failed
    // while the socket still works would rejoin the pool mid-transaction
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('rolls back rather than leaving a decision half-written', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1, source_membership: 'present', existence: 'extant' }] });
    const { client, queries } = makeClient();
    client.query.mockImplementation(async (sql: string) => {
      queries.push({ sql, params: [] });
      if (sql.includes('experience_curation_log')) throw new Error('log write failed');
      // The flag has to be standing or the handler refuses before it writes
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{
          curated_fields: [],
          source_membership: 'present',
          existence: 'extant',
          missing_since: new Date('2026-08-03T10:00:00Z'),
        }] };
      }
      return { rows: [] };
    });
    mockedConnect.mockResolvedValue(client);

    await expect(setExperienceState(
      { user: ADMIN, params: { id: '5' }, body: { membership: 'former', expected: { membership: 'present', existence: 'extant', flagged: true } } } as never,
      makeRes() as never,
    )).rejects.toThrow('log write failed');

    expect(queries.some(q => q.sql === 'ROLLBACK')).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('acceptSourceValue', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('refuses a curator whose scope does not reach the experience', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await acceptSourceValue(
      { user: CURATOR, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('says so when the source never proposed anything', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    mockedConnect.mockResolvedValue(makeClient(['name'], undefined, []).client);
    const res = makeRes();

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('releases the curator claim, or the next run would refuse the value again', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'Renamed upstream', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name', 'description'], undefined, PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(update?.sql).toContain('name = $2');
    expect(update?.params).toContain('Renamed upstream');
    // 'name' released, 'description' still claimed
    expect(update?.params).toContain(JSON.stringify(['description']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fromSyncLogId: 9 }));
  });

  it('will not write a proposal the source has since withdrawn', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    // The withdrawal check is in the SQL, so a withdrawn proposal comes back
    // as no row — the same answer as no proposal ever existing
    const { client, queries } = makeClient(['name'], undefined, []);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 41 } } as never,
      res as never,
    );

    const lookup = queries.find(q => q.sql.includes('experience_sync_changes'));
    expect(lookup?.sql).toContain('last_seen_sync_log_id');
    // Same gate as the queue, or a card fetched before a run started would be
    // refused mid-run with "no proposal on record", which is false
    // The two copies must stay identical, or the endpoint would refuse a
    // newer proposal while writing a retracted one. Sharing one definition is
    // what makes that structural; this asserts they really do share it.
    const queueSql = CHANGESET_LANDED_SQL.replace(/\s+/g, ' ').trim();
    expect(lookup!.sql.replace(/\s+/g, ' ')).toContain(queueSql);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
  });

  it('resolves the proposal under the same lock that writes it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], undefined, PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // Resolving it before the lock would let a run landing in between have its
    // values written under the run id the curator sent — the substitution
    // expectedSyncLogId exists to refuse
    expect(queries[0].sql).toBe('BEGIN');
    expect(queries.some(q => q.sql.includes('experience_sync_changes'))).toBe(true);
    const lookup = queries.findIndex(q => q.sql.includes('experience_sync_changes'));
    const write = queries.findIndex(q => q.sql.includes('UPDATE experiences'));
    expect(lookup).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(lookup);
  });

  it('finishes rolling back before letting go of the client', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 42, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], undefined, PROPOSAL);
    let rollbackDone = false;
    let releasedBeforeRollback = false;
    const inner = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'ROLLBACK') {
        await new Promise(r => setTimeout(r, 5));
        rollbackDone = true;
        queries.push({ sql, params: params ?? [] });
        return { rows: [] };
      }
      return inner(sql, params);
    });
    client.release.mockImplementation(() => { if (!rollbackDone) releasedBeforeRollback = true; });
    mockedConnect.mockResolvedValue(client);

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 41 } } as never,
      makeRes() as never,
    );

    // An unawaited refusal settles the try block at once, so `finally` hands
    // the client back while its ROLLBACK is still running on the wire
    expect(releasedBeforeRollback).toBe(false);
  });

  it('refuses a proposal a newer run has replaced', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    // The card was drawn from run 41; run 42 has since proposed something else
    const PROPOSAL = [{ sync_log_id: 42, changed_fields: [{ field: 'name', new: 'Rathaus', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], undefined, PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 41 } } as never,
      res as never,
    );

    // Writing here would replace the curator's edit with a value they never
    // saw — the same exposure `expected` closes on the verdict path
    expect(res.status).toHaveBeenCalledWith(409);
    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
  });

  it('names the run its value came from, since a later one may differ', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 42, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    mockedConnect.mockResolvedValue(makeClient(['name'], undefined, PROPOSAL).client);
    const res = makeRes();

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 42 } } as never,
      res as never,
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ applied: ['name'], released: [], fromSyncLogId: 42 }));
  });

  it('releases a field it cannot write, since nothing else ever would', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'tags', new: ['a'], curatedConflict: true }] }];
    const { client, queries } = makeClient(['tags', 'name'], undefined, PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    // 'tags' carries a real proposal but has no column here. Editing would not
    // clear it either — every other writer of curated_fields only ever adds —
    // so releasing the claim is the only way off the queue, and the next run
    // then writes the value through the ordinary upsert.
    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['tags'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    const update = queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(update?.sql).not.toContain('tags =');
    expect(update?.params).toContain(JSON.stringify(['name']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ applied: [], released: ['tags'] }));
  });

  it('reads the claim it is about to rewrite under the same lock', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    const { client, queries } = makeClient(['name'], undefined, PROPOSAL);
    mockedConnect.mockResolvedValue(client);

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      makeRes() as never,
    );

    // Reading it before the transaction and writing the filtered result back
    // would drop whatever a concurrent edit claimed in between
    const order = queries.map(q => q.sql.trim().split(/\s+/).slice(0, 2).join(' '));
    expect(order[0]).toBe('BEGIN');
    expect(queries[1].sql).toContain('FOR UPDATE');
    expect(queries.findIndex(q => q.sql.includes('UPDATE experiences'))).toBeGreaterThan(1);
  });

  it('does not overwrite an answer another curator already gave', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    // The claim was released while this request was in flight
    const { client, queries } = makeClient([], undefined, PROPOSAL);
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['name'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(queries.some(q => q.sql.includes('UPDATE experiences'))).toBe(false);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('refuses a field the source did not propose', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: 1 }] });
    const PROPOSAL = [{ sync_log_id: 9, changed_fields: [{ field: 'name', new: 'X', curatedConflict: true }] }];
    mockedConnect.mockResolvedValue(makeClient(['name'], undefined, PROPOSAL).client);
    const res = makeRes();

    await acceptSourceValue(
      { user: ADMIN, params: { id: '5' }, body: { fields: ['description'], expectedSyncLogId: 9 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('setExperienceAdmission', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    mockedPlace.mockClear();
    mockedPlace.mockResolvedValue(3);
  });

  /** The row lookup and the scope check both run on the pool before the lock. */
  function poolAnswers(categoryId = 2) {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, category_id: categoryId }] })
      .mockResolvedValueOnce({ rows: [{ unrestricted: true, scoped_region_id: null }] });
  }

  /** A locked row, refused and unanswered unless the test says otherwise. */
  function refusedClient(overrides: Record<string, unknown> = {}, rowCounts: Record<string, number> = {}) {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    return {
      queries,
      client: {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params: params ?? [] });
          if (sql.includes('FOR UPDATE')) {
            return { rows: [{
              admission: 'refused',
              admission_reason: 'not an art museum',
              curated_fields: [],
              // The common refused row: already visible before the rule caught
              // it, not a fresh gated arrival. Tests exercising the `pending`
              // publish path override this explicitly.
              curation_state: 'auto',
              ...overrides,
            }] };
          }
          const counted = Object.entries(rowCounts).find(([fragment]) => sql.includes(fragment));
          return { rows: [], rowCount: counted ? counted[1] : 0 };
        }),
        release: vi.fn(),
      },
    };
  }

  it('puts an overridden row back and pins it against the next run', async () => {
    poolAnswers();
    const { queries, client } = refusedClient();
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.params[1]).toBe('admitted');
    expect(JSON.parse(String(update.params[3]))).toContain('admission');
    // This row was already `auto` — visible before the rule caught it — so
    // putting it back publishes nothing; see the `pending` cases below for the
    // publish path itself.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ experienceId: 5, admission: 'admitted', published: false }));
  });

  it('leaves a confirmed row refused, and pins that too', async () => {
    poolAnswers();
    const { queries, client } = refusedClient();
    mockedConnect.mockResolvedValue(client);

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never,
      makeRes() as never);

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.params[1]).toBe('refused');
    // Pinned either way: a curator who looked at the thing outranks the rule in
    // both directions, so a later run must not re-admit a confirmed row.
    expect(JSON.parse(String(update.params[3]))).toContain('admission');
  });

  it('keeps the reason on a confirmed row and drops it from an overridden one', async () => {
    poolAnswers();
    const { queries, client } = refusedClient();
    mockedConnect.mockResolvedValue(client);

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never,
      makeRes() as never);

    // The refused set is the list the archaeology category gets built from, so
    // the rule's objection has to survive being agreed with.
    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.params[2]).toBe('not an art museum');
  });

  it('drops the reason from a row put back, where it has stopped being true', async () => {
    poolAnswers();
    const { queries, client } = refusedClient();
    mockedConnect.mockResolvedValue(client);

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never,
      makeRes() as never);

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.params[2]).toBeNull();
  });

  it('logs which way the curator went', async () => {
    poolAnswers();
    const { queries, client } = refusedClient();
    mockedConnect.mockResolvedValue(client);

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never,
      makeRes() as never);

    const log = queries.find(q => q.sql.includes('experience_curation_log'))!;
    expect(log.params[2]).toBe('admission_overridden');
  });

  it('overriding a refused pending row publishes it, in the same statement', async () => {
    poolAnswers();
    const { queries, client } = refusedClient({ curation_state: 'pending' });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.sql).toContain(`curation_state = 'verified'`);
    expect(update.sql).toContain('published_at = COALESCE(published_at, NOW())');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ experienceId: 5, admission: 'admitted', published: true }));

    const log = queries.find(q => q.sql.includes('experience_curation_log'))!;
    expect(JSON.parse(String(log.params[4]))).toMatchObject({ published: true });
  });

  it('also publishes the arrival\'s pending locations and treasure links, and reports the counts', async () => {
    // Un-refusing an arrival is a publication (ADR-0025 § 4.5): the object and
    // everything that arrived under it, or the museum comes back with no pin
    // and no works, which is the list-versus-map disagreement this codebase
    // treats as the serious kind.
    poolAnswers();
    const { queries, client } = refusedClient({ curation_state: 'pending' }, {
      'UPDATE experience_locations SET curation_state': 2,
      'UPDATE experience_treasures': 12,
      'UPDATE treasures': 12,
    });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      locationsPublished: 2, treasureLinksPublished: 12, treasuresPublished: 12,
    }));
    const log = queries.find(q => q.sql.includes('experience_curation_log'))!;
    expect(JSON.parse(String(log.params[4]))).toMatchObject({
      locations: 2, treasureLinks: 12, treasures: 12,
    });
  });

  it('releases a withdrawal the arrival\'s publish uncovers, and re-places the object', async () => {
    // Nothing about a row being refused stops a later sync run deferring a
    // withdrawal on one of its locations — the same reachable case
    // `publishController.ts`'s own publish answers, and this override reaches
    // it through the same shared unit.
    poolAnswers();
    const { queries, client } = refusedClient({ curation_state: 'pending' }, {
      'UPDATE experience_locations SET curation_state': 1,
      'SET missing_since = NOW()': 1,
    });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ withdrawalsReleased: 1 }));
    const log = queries.find(q => q.sql.includes('experience_curation_log'))!;
    expect(JSON.parse(String(log.params[4]))).toMatchObject({ withdrawalsReleased: 1 });
    // After the COMMIT and off this client — placement opens a transaction of
    // its own, so mocking it through the fake client would prove nothing about
    // whether it ran off this one.
    expect(mockedPlace).toHaveBeenCalledWith([5], 1);
    expect(mockedPlace).toHaveBeenCalledWith([5], 4);
  });

  it('does not place the object when nothing was withdrawn', async () => {
    // "Publish places" reads as the obvious symmetry and is wrong: placing
    // every arrival on override would delete and reinsert region rows for no
    // change at all.
    poolAnswers();
    const { client } = refusedClient({ curation_state: 'pending' }, {
      'UPDATE experience_locations SET curation_state': 1,
    });
    mockedConnect.mockResolvedValue(client);

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, makeRes() as never);

    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it('reports placementFailed when the re-place after a release does not land', async () => {
    poolAnswers();
    const { client } = refusedClient({ curation_state: 'pending' }, {
      'UPDATE experience_locations SET curation_state': 1,
      'SET missing_since = NOW()': 1,
    });
    mockedConnect.mockResolvedValue(client);
    mockedPlace.mockRejectedValueOnce(new Error('world view 1 is busy'));
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    // The publication itself still landed — a curator whose click did land
    // must not be told it failed because a follow-up step did.
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ placementFailed: true }));
  });

  it('overriding a refused auto row changes neither curation_state nor published_at, and publishes no content', async () => {
    // It was already visible before the rule refused it — nothing about this
    // verdict says anyone has now read it, so not one of its content rows may
    // move even if some of them happen to be `pending` on their own (ADR-0025:
    // a container can stay `auto`/`verified` while a specific point or work
    // under it is still unread).
    poolAnswers();
    const { queries, client } = refusedClient({ curation_state: 'auto' }, {
      // Configured so that, if the gate below were ever removed, this test
      // would still catch it: a non-zero count here means the statement ran
      // and wrote something, not merely that it matched nothing.
      'UPDATE experience_locations SET curation_state': 1,
      'UPDATE experience_treasures': 1,
      'UPDATE treasures': 1,
    });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.sql).not.toContain('curation_state');
    expect(update.sql).not.toContain('published_at');
    // Not just zero counts — no content statement fires at all, so a row with
    // pending content of its own is not swept up by an unrelated admission
    // verdict.
    expect(queries.some(q => q.sql.includes('UPDATE experience_locations'))).toBe(false);
    expect(queries.some(q => q.sql.includes('UPDATE experience_treasures'))).toBe(false);
    expect(queries.some(q => q.sql.includes('UPDATE treasures'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith({
      experienceId: 5, admission: 'admitted', published: false,
      curationState: 'auto', appliedFields: [], claimedFieldsSkipped: [], fromSyncLogId: null,
      locationsPublished: 0, treasureLinksPublished: 0, treasuresPublished: 0, withdrawalsReleased: 0,
    });

    const log = queries.find(q => q.sql.includes('experience_curation_log'))!;
    expect(JSON.parse(String(log.params[4]))).toMatchObject({
      published: false, locations: 0, treasureLinks: 0, treasures: 0, withdrawalsReleased: 0,
    });
  });

  it('never publishes on confirm, even from a pending row', async () => {
    // Confirming leaves an already-invisible row invisible — the opposite verdict
    // from override, and the one that must never touch curation_state.
    poolAnswers();
    const { queries, client } = refusedClient({ curation_state: 'pending' }, {
      'UPDATE experience_locations SET curation_state': 1,
    });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never, res as never);

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.sql).not.toContain('curation_state');
    expect(update.sql).not.toContain('published_at');
    // Confirming never publishes the object, and must not publish its
    // contents either — the same gate that protects an `auto` row protects a
    // `pending` one from the other verdict.
    expect(queries.some(q => q.sql.includes('UPDATE experience_locations'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      experienceId: 5, admission: 'refused', published: false,
      locationsPublished: 0, treasureLinksPublished: 0, treasuresPublished: 0,
    }));
  });

  it('asks the locked read for every column this decision rests on', async () => {
    // The mocked client answers `FOR UPDATE` with a full row whatever the
    // SELECT actually named, so a column dropped from that list is invisible to
    // every other test here while `undefined` in production — the publish
    // decision would silently stop firing. Proved by mutation: dropping
    // `curation_state` from the SELECT this task added killed no test until
    // this one existed.
    poolAnswers();
    const { queries, client } = refusedClient({ curation_state: 'pending' });
    mockedConnect.mockResolvedValue(client);

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, makeRes() as never);

    const locked = queries.find(q => q.sql.includes('FOR UPDATE'))!;
    for (const column of ['admission', 'admission_reason', 'curated_fields', 'curation_state']) {
      expect(locked.sql, `the locked read does not select ${column}`).toContain(column);
    }
  });

  it('refuses a second answer to the same card', async () => {
    poolAnswers();
    const { client } = refusedClient({ curated_fields: ['admission'] });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('still puts back a row a curator already confirmed', async () => {
    // The one asymmetry in this endpoint, and the reason it is not a one-way
    // door: confirming hides the object from everyone and no read reveals it,
    // so if the pin closed this direction too, a mis-click would be permanent.
    poolAnswers();
    const { queries, client } = refusedClient({ curated_fields: ['admission'] });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    const update = queries.find(q => q.sql.includes('UPDATE experiences'))!;
    expect(update.params[1]).toBe('admitted');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ experienceId: 5, admission: 'admitted', published: false }));
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  it('404s a row deleted between the existence check and the lock', async () => {
    // The two reads are on different connections and a moment apart. Reading
    // curated_fields off nothing would answer 500 to a question whose true
    // answer is 404.
    poolAnswers();
    // Every read on this connection answers empty, the locked one included:
    // the row is gone.
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('refuses to put back a row that is already admitted', async () => {
    // Nothing to correct, and answering anyway would let a stale card overwrite
    // whatever the row's state actually is.
    poolAnswers();
    const { client } = refusedClient({ admission: 'admitted', curated_fields: ['admission'] });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'override' } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('refuses to answer a row that was never refused', async () => {
    poolAnswers();
    const { client } = refusedClient({ admission: 'admitted' });
    mockedConnect.mockResolvedValue(client);
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('404s an experience that does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('403s a curator whose scope does not reach the row', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, category_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const res = makeRes();

    await setExperienceAdmission(
      { params: { id: '5' }, user: CURATOR, body: { decision: 'override' } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('reads the row under the write lock, not before it', async () => {
    poolAnswers();
    const { queries, client } = refusedClient();
    mockedConnect.mockResolvedValue(client);

    await setExperienceAdmission(
      { params: { id: '5' }, user: ADMIN, body: { decision: 'confirm' } } as never,
      makeRes() as never);

    // Every curator covering any of the row's regions sees this card. An
    // unlocked read lets two answers race and leaves the log asserting one
    // verdict beside a column holding the other.
    expect(queries[0].sql).toBe('BEGIN');
    expect(queries[1].sql).toContain('FOR UPDATE');
  });
});
