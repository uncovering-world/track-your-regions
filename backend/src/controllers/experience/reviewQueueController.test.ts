/**
 * Tests for the review queue's seven kinds.
 *
 * Split out of `lifecycleController.test.ts` when that file passed eslint's
 * `max-lines` (1000, comments and blanks excluded). The seam was already there:
 * the queue is one read with seven independent queries, and everything left
 * behind is a curator write under a row lock — and #526 split the controllers
 * along the same seam, so this file now sits beside the module it tests.
 *
 * What these pin, one sentence each: every kind carries the curator scope filter
 * and the refusal predicate; a row the source stopped listing raises one card
 * rather than two that contradict each other; a field a curator claimed belongs
 * to `conflict` and a field the gate held belongs to `held`; and each kind says
 * which kind it is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getReviewQueue } from './reviewQueueController.js';
import { ORPHANED_RUN_ERROR } from '../../services/sync/syncLogMarkers.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 7, role: 'curator' as const };
const ADMIN = { id: 1, role: 'admin' as const };

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

  it('names who claimed each field and when, by the key the claim is stored under', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    const [conflictSql] = callMatching("'conflict' AS kind");
    // The claim itself is set membership in `curated_fields` and carries no
    // author; the act that put it there is an `edited` log entry, keyed by the
    // *column* name — so the lookup goes through the same map the claim does.
    // Reading it by the changeset's own name would find nothing for
    // `shortDescription`, and the card would say "a curator" about every edit.
    expect(conflictSql).toContain("log.action = 'edited'");
    expect(conflictSql).toMatch(/log\.details \? COALESCE\(\s*\$\d+::jsonb->>\(f->>'field'\), f->>'field'\)/);
    // Newest wins, and `created_at` alone does not decide it: two edits in one
    // request share a timestamp, so the id breaks the tie the way it does
    // everywhere else in this file.
    expect(conflictSql).toContain('ORDER BY log.created_at DESC, log.id DESC');
    // A curator with no display name is still a person who decided: the card
    // says "a curator", never `null` and never an email address.
    expect(conflictSql).toContain("COALESCE(u.display_name, 'a curator')");
  });

  it('reads the log through the log’s own per-row scope, not the object’s', async () => {
    await getReviewQueue({ user: CURATOR, query: {} } as never, makeRes() as never);

    const [conflictSql] = callMatching("'conflict' AS kind");
    // The outer filter admits an object through *any* of its regions, so a curator
    // scoped to one of them sees a card about an object another curator edited under a
    // region they do not cover. Reading the log per experience would then name that
    // curator, their dates and the values they applied — the rows `getCurationLog`
    // drops for the same reader. Same predicate, same shape: a row belonging to no
    // region is an admin's or a global curator's act and stays visible to everyone.
    expect(conflictSql).toContain('log.region_id IS NULL');
    expect(conflictSql).toContain('log.region_id IN (SELECT id FROM curator_scoped_regions)');
    // Both reads, not only the first: the claim and the earlier decisions come from the
    // same table and leak the same way.
    expect(conflictSql.match(/log\.region_id IN \(SELECT id FROM curator_scoped_regions\)/g))
      .toHaveLength(2);
  });

  it('does not filter the log for an admin, who is scoped to everything', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).not.toContain('log.region_id IN');
  });

  it('carries the earlier decisions on the same field, and the run date the card asks about', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    const [conflictSql] = callMatching("'conflict' AS kind");
    // `accepted_source` records the fields it applied in `details.fields`, so a
    // field's history is those entries naming it — an empty array rather than
    // null, because the card renders a list and "nothing decided yet" is a list
    // of none.
    expect(conflictSql).toContain("log.action = 'accepted_source'");
    expect(conflictSql).toContain("d->>'field' = f->>'field'");
    expect(conflictSql).toContain("'[]'::jsonb)))");
    // The run's own date, read off the log the item already names.
    expect(conflictSql).toContain('l.completed_at AS run_completed_at');
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
    //
    // Read off the field's own flag, not from the absence of a claim (#519): an
    // elimination would silently reclassify any future third reason a write was
    // refused as gate-held, and this card is what publishing then writes.
    const sql = await capturedQueueSql('held');
    expect(sql).toContain("(f->>'held')::boolean");
    expect(sql).not.toContain('curatedConflict');
  });

  it('does not offer an acceptable flag on a held field', async () => {
    // 'acceptable' is the conflict path's concept — accept-source's own
    // lookup requires a curatedConflict:true field, which held's now
    // deliberately excludes, so a true flag here would advertise a button
    // that always 409s.
    const sql = await capturedQueueSql('held');
    expect(sql).not.toContain('acceptable');
  });

  it('labels all three new kinds, like the four that predate them', async () => {
    // `ReviewQueueItem.kind` is declared required and is a real column on the
    // older four (`'missing' AS kind` and its siblings). The three added here did
    // not select it, so three of the union's seven values were never sent while
    // the type said they always are — and a card cannot ask what it is.
    for (const [kind, label] of [
      ['arrival', "'arrival' AS kind"],
      ['held', "'held' AS kind"],
      ['contents', "'contents' AS kind"],
    ] as const) {
      expect(await capturedQueueSql(kind), `${kind} does not label itself`).toContain(label);
    }
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
    // Anchored on the JOIN clause itself. The predicate used to appear twice in
    // this statement — here and in a FILTER on the count — and a `.toContain` on
    // the text alone stayed green with this copy deleted, which is the trap the
    // previous task's review found. The FILTER is gone now (the join makes it
    // redundant), so one occurrence is left; the anchor stays on the clause
    // rather than the fragment, because that is what this test is about.
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
      "FILTER (WHERE et.curation_state = 'pending' OR t.curation_state = 'pending'))::int AS pending_treasures",
    );
  });

  it('hands both counts over as numbers, not as bigint strings', async () => {
    // `COUNT(*)` is bigint and `pg` returns those as strings, so an uncast count
    // arrives as "12". Coercion covers arithmetic; it does not cover a plural
    // rule, which compares against 1 — and `'1' === 1` is false, so the queue
    // page would read "1 points" to the curator it is asking.
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain('COUNT(DISTINCT el.id)::int AS pending_locations');
    expect(sql).toContain('))::int AS pending_treasures');
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
