/**
 * Tests for the review queue's eight kinds.
 *
 * Split out of `lifecycleController.test.ts` when that file passed eslint's
 * `max-lines` (1000, comments and blanks excluded). The seam was already there:
 * the queue is one read with eight independent queries, and everything left
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

  it('pages each kind on its own offset', async () => {
    await getReviewQueue(
      { user: ADMIN, query: { refusedOffset: 25, conflictsOffset: 50 } } as never,
      makeRes() as never,
    );

    // Eight queries with eight LIMITs: one shared offset moved all of them at once, so a
    // kind whose page was full had a page 2 no control could ask for.
    const [, refusedParams] = callMatching("e.admission = 'refused'\n      AND NOT");
    const [, conflictParams] = callMatching("'conflict' AS kind");
    const [, missingParams] = callMatching('missing_since IS NOT NULL');
    expect(refusedParams.at(-1)).toBe(25);
    expect(conflictParams.at(-1)).toBe(50);
    expect(missingParams.at(-1)).toBe(0);
  });

  it('asks for one row more than the page, so a total is never needed', async () => {
    const res = makeRes();
    // Exactly `limit + 1` rows come back: the extra one is the answer to "is there more",
    // and it must not reach the caller as an item.
    mockedQuery.mockImplementation(async (sql: string) => (
      String(sql).includes("e.admission = 'refused'\n      AND NOT")
        ? { rows: Array.from({ length: 4 }, (_, i) => ({ id: i })) }
        : { rows: [] }
    ));

    await getReviewQueue({ user: ADMIN, query: { limit: 3 } } as never, res as never);

    const answered = res.json.mock.calls[0][0];
    expect(answered.refused).toHaveLength(3);
    expect(answered.paging.refused).toEqual({ offset: 0, hasMore: true });
    expect(answered.paging.missing).toEqual({ offset: 0, hasMore: false });
    // Still one query per kind and no ninth: "is there another page" is answered by the
    // extra row, so no count query joins the eight. (The contents query counts a *row's*
    // points and works, and the withdrawal query counts the points it still offers —
    // different numbers, both about one row, and both stay.)
    expect(mockedQuery.mock.calls).toHaveLength(8);
    // And every one of them asked for `limit + 1`. The mock answers with four rows whatever
    // it is asked, so without this the page size could regress to `limit` and the three
    // items plus `hasMore: true` above would still be produced — by the mock, not the code.
    for (const call of mockedQuery.mock.calls) {
      const params = call[1] as unknown[];
      expect(params.at(-2)).toBe(4);
    }
  });

  it('stops asking about a proposal a curator already refused', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // Standing by your own edit used to be the absence of an action, so the card
    // came back after every run — Aksum's three times in two days, with the source
    // proposing the identical value each time.
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toContain('experience_conflict_decisions');
    expect(conflictSql).toContain("d.field = f->>'field'");
  });

  it('compares the refusal by value, so a source that changed its mind is heard', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // The one case a curator must not miss. Suppressing by field would answer
    // every future proposal with an answer given about a different value.
    //
    // Asserted as one predicate rather than as three substrings that could each be
    // satisfied by a sibling fragment of the same statement — the whole point is that
    // the field and the value are tested *together*, on the same row.
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM experience_conflict_decisions d\s+WHERE d\.experience_id = e\.id\s+AND d\.field = f->>'field'\s+AND d\.declined = COALESCE\(f->'new', 'null'::jsonb\)\)/,
    );
  });

  it('treats a proposal with no value and a refusal of none as the same thing', async () => {
    await getReviewQueue({ user: ADMIN, query: {} } as never, makeRes() as never);

    // A source that stops publishing a claimed `metadata.*` key proposes `undefined`,
    // which JSON.stringify drops from the changeset row — while the refusal of it is
    // stored as jsonb `null`. Compared against SQL NULL that is never true, so the card
    // would return after a refusal that answered 200 and said the question was settled.
    const [conflictSql] = callMatching("'conflict' AS kind");
    expect(conflictSql).toContain("COALESCE(f->'new', 'null'::jsonb)");
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
    // Both actions that can put a key in `curated_fields`, not just the object's
    // own edit: a correction to a single-point object's point claims `location`
    // on the experience and records `location_edited` (ADR-0029), and matching
    // one of them left exactly that claim unattributed — on the ordinary path,
    // since a corrected site raises a conflict card on every run afterwards.
    expect(conflictSql).toContain("log.action = 'edited'");
    // And the point-level act only where it really claimed the object's field: a
    // point rename writes a `name` key and claims nothing on the experience, so
    // on the action alone the newest rename outranked the edit that claimed the
    // museum's name and the card named a curator who never claimed it.
    expect(conflictSql).toContain("log.action = 'location_edited'");
    expect(conflictSql).toContain("(log.details->>'anchorMoved')::boolean");
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
    // Both answers record their fields in `details.fields`, so a field's history is
    // those entries naming it — an empty array rather than null, because the card
    // renders a list and "nothing decided yet" is a list of none.
    //
    // Both kinds, and not only acceptances: a trail that showed one of them would
    // report a field answered once when it was answered twice, and would say the
    // field went the source's way every time it went the other.
    expect(conflictSql).toContain("log.action IN ('accepted_source', 'declined_source')");
    expect(conflictSql).toContain("'action', log.action");
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
    withdrawn: 'el.missing_since IS NOT NULL',
    refused: "'refused' AS kind",
    conflicts: "'conflict' AS kind",
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
    // not select it, so three of the union's values were never sent while
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
    // Anchored inside the points subquery rather than on the statement, because the
    // same fragment is legitimately elsewhere in it: `offeredLocationSql` is what
    // `contentsWaitingSql` composes too, and a `.toContain` over the whole text
    // stayed green once already with the clause it was about deleted. Sliced rather
    // than matched with a nested quantifier — the comment lines inside the subquery
    // would need `(?:…)*`, which `security/detect-unsafe-regex` objects to, fairly,
    // in a file whose other guards say a safety check must not itself backtrack.
    const points = sql.slice(sql.indexOf('FROM experience_locations el'));
    const where = points.slice(0, points.indexOf(') el'));
    expect(where).toContain("WHERE el.experience_id = e.id AND el.curation_state = 'pending'");
    expect(where).toContain("AND el.missing_since IS NULL AND el.existence <> 'lost'");
  });

  it('does not count a withdrawn or lost pending point as unread', async () => {
    // Neither a point the source has stopped offering nor one a curator has
    // declared gone from the world is "unread" in any sense a reader would
    // notice: every reader-facing location read carries the same fragment, so
    // publishing either changes nothing on screen. Both terms asserted, because
    // the count that drops one of them would still pass on the other.
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain("el.missing_since IS NULL AND el.existence <> 'lost'");
  });

  it('counts a treasure held by either its link or the work itself', async () => {
    // A link's curation_state and its treasure's are independent axes
    // (ADR-0025): a work is checked once, globally, a link "as being HERE".
    // getExperienceTreasures gates both separately, and this count has to
    // ask the same two questions or a treasure whose link was reviewed while
    // the shared work was not would be invisible and unasked-about forever.
    const sql = await capturedQueueSql('contents');
    expect(sql).toContain('JOIN treasures t ON t.id = et.treasure_id');
    expect(sql).toContain("WHERE et.experience_id = e.id\n          AND (et.curation_state = 'pending' OR t.curation_state = 'pending')");
  });

  it('hands both counts over as numbers, not as bigint strings', async () => {
    // `COUNT(*)` is bigint and `pg` returns those as strings, so an uncast count
    // arrives as "12". Coercion covers arithmetic; it does not cover a plural
    // rule, which compares against 1 — and `'1' === 1` is false, so the queue
    // page would read "1 points" to the curator it is asking.
    const sql = await capturedQueueSql('contents');
    // Twice, one per lateral: the two counts are computed in separate subqueries
    // now, so a cast dropped from either is a cast dropped from a card.
    expect(sql.split('COUNT(*)::int AS total')).toHaveLength(3);
  });

  it('cannot multiply locations by treasures, because neither is joined to the other', async () => {
    // They are independent one-to-many on the same experience, so joined side by
    // side their rows are a product — 3 pending points and 12 pending works make
    // 36. `COUNT(DISTINCT ...)` used to absorb that; a list cannot, and would show
    // each point twelve times. Aggregated in their own laterals the product has
    // nowhere to form, which is a stronger promise than counting distinctly and is
    // asserted as such: no top-level join to either table.
    const sql = await capturedQueueSql('contents');
    // Every join type, not only the one the old query used: a plain `JOIN` forms
    // the same product, and an assertion naming `LEFT JOIN` would have watched
    // the wrong keyword. Neither table is joined at all here — each is read
    // inside its own lateral — so the strings themselves must be absent.
    expect(sql).not.toContain('JOIN experience_locations');
    expect(sql).not.toContain('JOIN experience_treasures');
    expect(sql.split('CROSS JOIN LATERAL')).toHaveLength(3);
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

  /**
   * The eighth kind: a point the source stopped offering, waiting on a verdict
   * (ADR-0026, #541).
   *
   * One row per container, listing the points inside it, because the queue is a
   * list of objects and a serial site can lose two components in one run. The
   * decision is per point — `POST /locations/:locationId/state` — which is the
   * same shape the gated `contents` card already has.
   */
  it('asks about a point the source stopped offering', async () => {
    const sql = await capturedQueueSql('withdrawn');

    expect(sql).toContain('el.missing_since IS NOT NULL');
    // Only the points nobody has answered for. A verdict leaves `missing_since`
    // standing (it is what keeps the point off the map), so without these two the
    // card would come back for ever with the answer already recorded on it.
    expect(sql).toContain("el.source_membership = 'present'");
    expect(sql).toContain("el.existence = 'extant'");
  });

  it('asks nothing about a point no reader ever saw', async () => {
    const sql = await capturedQueueSql('withdrawn');

    // The same reasoning ADR-0025 § 3.6 applies to an unread object: the card asks
    // whether a place readers could see has gone, and about an arrival the gate never
    // released there is no such fact. Reachable, not theoretical — a gated source can
    // offer a point and withdraw it before anyone publishes it.
    expect(sql).toContain("el.curation_state <> 'pending'");
  });

  it('leaves a held withdrawal out, because the run did not perform one', async () => {
    const sql = await capturedQueueSql('withdrawn');

    // A withdrawal waiting on its replacement has `missing_since IS NULL` — the
    // point is still on the map — so it cannot reach this query at all. Asserted
    // on the arrival's own column rather than trusting that: the pairing is what
    // says a withdrawal is in flight, and a curator asked "did this go?" about a
    // point they can still see has no true answer to give.
    expect(sql).toContain('el.withdrawal_deferred_for_location_id');
  });

  it('does not offer a point that is itself on its way out as the replacement', async () => {
    const sql = await capturedQueueSql('withdrawn');

    // `replacedMetres` is the difference between "gone" and "moved", and the card turns
    // its whole sentence on it — including "readers never lost it". A deferral holds one
    // departure per unread arrival, so a run that drops two points of one reference and
    // offers a single arrival leaves the second one visible with an arrival pointing at
    // it: offered by `offeredLocationSql`, metres away, and about to go. Measured as a
    // replacement it makes the card promise a part the source stopped listing is still
    // listed. It is the same departure paused.
    const moved = sql.slice(sql.indexOf("'replacedMetres'"), sql.indexOf('ORDER BY el.missing_since'));
    expect(moved).toContain('pausing.withdrawal_deferred_for_location_id = moved.id');
    expect(moved).toContain('NOT EXISTS');
  });

  it('says how much the object holds, on every kind', async () => {
    // "A point of Berlin Modernism Housing Estates is gone" reads differently at one
    // part of seven and at the only part there was — and so does a proposed
    // description of one component, which is the case that found this (UNESCO 1239).
    // So it rides on the shared object-context fragment rather than on the two cards
    // that happen to need it today, and this asserts every kind carries it —
    // `conflicts` first among equals, since the Berlin card is a conflict and is the
    // case that asked for the count at all.
    for (const kind of ['arrival', 'missing', 'held', 'contents', 'withdrawn', 'conflicts', 'refused'] as const) {
      const sql = await capturedQueueSql(kind);
      expect(sql, `${kind} lost the point count`).toContain('AS offered_locations');
      // Both terms, because the count is what "made of N places" reads: written by
      // hand it counted a point a curator had declared gone from the world.
      expect(sql, `${kind}'s point count stopped using the shared predicate`)
        .toMatch(/off\.missing_since IS NULL AND off\.existence <> 'lost'/);
      expect(sql, `${kind} lost the works count`).toContain('AS counted_works_total');
    }
  });

  it('states the works total once, not twice, on the refusal kinds', async () => {
    // Both counts moved into the shared fragment, and the refusal query used to
    // select the total itself. Two columns of the same name are legal SQL and the
    // driver hands over whichever came last — so the duplicate would be invisible
    // rather than loud.
    const sql = await capturedQueueSql('refused');
    expect(sql.split('AS counted_works_total')).toHaveLength(2);
  });

  it('names each withdrawn point, rather than counting them', async () => {
    const sql = await capturedQueueSql('withdrawn');

    // The verdict is per point, so the card needs the id to send it to — and the
    // name and reference to say which point it is about. Bilbao's is nameless,
    // which is why the reference travels beside the name rather than instead of it.
    expect(sql).toContain('jsonb_agg');
    expect(sql).toContain('el.external_ref');
    expect(sql).toContain('el.id');
    // The distance measures a replacement a reader can actually see: one that is
    // itself withdrawn, or declared gone, replaces nothing.
    expect(sql).toMatch(/moved\.missing_since IS NULL AND moved\.existence <> 'lost'/);
  });

  it('excludes a refused or unread container from the withdrawal card', async () => {
    const sql = await capturedQueueSql('withdrawn');

    // Same reasoning the other kinds carry: a refused row is already invisible for
    // a reason with its own card, and nobody has seen an unread one, so no point
    // inside it disappeared from in front of anyone.
    expect(sql).toContain("e.admission <> 'refused'");
    expect(sql).toContain("e.curation_state <> 'pending'");
  });

  it('limits a curator to what their scope reaches on the withdrawal card too', async () => {
    const sql = await capturedQueueSql('withdrawn', CURATOR);
    expect(sql).toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');
  });

  it('returns the withdrawal kind under its own response key, with its own pager', async () => {
    const res = makeRes();
    mockedQuery.mockImplementation(async (sql: string) => (
      String(sql).includes('el.missing_since IS NOT NULL')
        ? { rows: [{ id: 502, name: 'Bilbao Fine Arts Museum' }] }
        : { rows: [] }
    ));

    await getReviewQueue({ user: ADMIN, query: {} } as never, res as never);

    const body = res.json.mock.calls[0][0];
    expect(body.withdrawn).toEqual([
      expect.objectContaining({ id: 502, name: 'Bilbao Fine Arts Museum' }),
    ]);
    // Eight queries with eight LIMITs, so eight offsets: one shared number moved
    // all of them at once, and a full page of one kind hid a page 2 no control
    // could ask for.
    expect(body.paging.withdrawn).toEqual({ offset: 0, hasMore: false });
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
