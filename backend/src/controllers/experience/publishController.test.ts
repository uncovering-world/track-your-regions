/**
 * Tests for publishing — the answer to the three cards a gated source raises — and for
 * what it takes with it: an arrival takes its contents while named contents leave the
 * object alone, bare contents take every pending row of both kinds, and `published_at` is
 * not stamped onto a row a reader could already see; and for the body the route accepts.
 *
 * The rest of the endpoint has files of its own: a held proposal and the object's held
 * fields published alone (`publishController.held.test.ts`), every refusal and the
 * rollback behind it (`publishController.refusals.test.ts`), and where publishing leaves
 * the object (`publishController.placement.test.ts`). All of them drive the endpoint
 * through `publishController.fixtures.ts`.
 *
 * Every assertion is anchored to the one statement it is about: an assertion
 * that matches a sibling statement lets the predicate it names be deleted
 * under a green suite, so `only()` fails when a fragment matches more than one.
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

import { publishExperienceBodySchema } from '../../types/index.js';

import {
  grantScope, makeClient, none, only, publish, resetPublishMocks,
} from './publishController.fixtures.js';

beforeEach(resetPublishMocks);

describe('publishing an arrival', () => {
  it('publishes the object and everything unread it holds', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending' },
      rowCounts: { 'UPDATE experience_locations SET curation_state': 2, 'UPDATE experience_treasures': 12, 'UPDATE treasures': 12 },
    });

    const res = await publish({}, client);

    // The membership itself, and the two states that make it visible (#822):
    // the publication lands on the place's membership, the content on the place.
    const update = only(queries, 'UPDATE experience_kind_memberships');
    expect(update.sql).toContain(`curation_state = 'verified'`);
    expect(update.params).toEqual([77]);
    // Its contents go with it: naming none means all of them, which is what an
    // arrival card asks about — the whole object, nobody having seen any of it.
    expect(only(queries, 'UPDATE experience_locations SET curation_state').sql).not.toContain('ANY($2::int[])');
    expect(only(queries, 'UPDATE experience_treasures').sql).not.toContain('ANY($2::int[])');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      curationState: 'verified', locationsPublished: 2, treasureLinksPublished: 12, treasuresPublished: 12,
    }));
  });

  it('dates the row that nobody could see until now', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // COALESCE rather than NOW(): nothing returns a published row to `pending`
    // today, so this is a floor rather than a live case — but a bare NOW() here
    // is the shape that would restart a New-chip window if one ever did.
    expect(only(queries, 'UPDATE experience_kind_memberships').sql)
      .toContain('published_at = COALESCE(published_at, NOW())');
  });

  it('only counts what it actually changed', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // Without this predicate `rowCount` would report every row the caller's ids
    // matched, published or not — a publication of 12 works that publishes none.
    expect(only(queries, 'UPDATE experience_locations SET curation_state').sql).toContain(`curation_state = 'pending'`);
    expect(only(queries, 'UPDATE experience_treasures').sql).toContain(`curation_state = 'pending'`);
  });

  it('passes the work as well as the link, since a work is passed once globally', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // A reader's treasure list gates the link and the work separately, so
    // publishing one and not the other leaves the card's count unanswered.
    const works = only(queries, 'UPDATE treasures');
    expect(works.sql).toContain(`curation_state = 'verified'`);
    expect(works.sql).toContain('et.experience_id = $1');
  });

  it('records what it did, under an action the log will accept', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending' },
      rowCounts: { 'UPDATE experience_locations SET curation_state': 2, 'UPDATE experience_treasures': 12, 'UPDATE treasures': 12 },
    });

    await publish({}, client);

    // The permanent record of what a publish applied, and the only place that
    // says a claimed field was skipped. Every key is asserted, because the row
    // is read by a person reconstructing a decision months later and a key
    // silently absent reads as "nothing was skipped".
    const log = only(queries, 'INSERT INTO experience_curation_log');
    expect(log.sql).toContain(`'published'`);
    expect(JSON.parse(String(log.params[3]))).toEqual({
      scope: 'object',
      fields: [],
      claimedFieldsSkipped: [],
      // The parts written to and the ones the proposal named that no row
      // answered to (ADR-0037), for the same reader: absent, they read as
      // "no part was touched", which on a card about a work's attribution is
      // the opposite of what happened.
      parts: [],
      partsNotFound: [],
      fromSyncLogId: null,
      // Zero on every call that answers the whole card, which is every call that
      // existed before per-row answers (#722). Asserted rather than allowed to
      // drift: a non-zero here means the pointer stayed, and a trail that did not
      // say so would read the same for "published all of it" and "published one
      // row of six".
      heldLeftOpen: 0,
      locations: 2,
      treasureLinks: 12,
      treasures: 12,
      withdrawalsReleased: 0,
    });
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('says in the log which fields it applied and which it left claimed', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending', pending_change_sync_log_id: 53, curated_fields: ['name'] },
      proposal: [
        { field: 'name', new: 'X', held: true },
        { field: 'description', new: 'Y', held: true },
      ],
    });

    await publish({ expectedSyncLogId: 53 }, client);

    expect(JSON.parse(String(only(queries, 'INSERT INTO experience_curation_log').params[3])))
      .toMatchObject({ fields: ['description'], claimedFieldsSkipped: ['name'], fromSyncLogId: 53 });
  });

  it('dates the works it passes, since a work is a row in its own right', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // `experience_locations` and `experience_treasures` have no `updated_at`
    // column; `treasures` does, and a row whose state changed without its
    // timestamp moving is a row nothing downstream can tell has changed.
    expect(only(queries, 'UPDATE treasures').sql).toContain('updated_at = NOW()');
  });

  it('leaves a point the source has withdrawn unread', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // The same predicate the `contents` card carries. Publishing a withdrawn
    // point looks harmless — no reader-facing read offers it — right up to the
    // run that offers it again, which clears `missing_since` and leaves
    // `curation_state` alone: the coordinate then appears on the map marked as
    // one a curator passed, having been on no card at any point.
    // Both terms of `offeredLocationSql`, because the bare predicate satisfies
    // one of them: asserting `missing_since IS NULL` alone stays
    // green if the existence term is dropped, and the invariant this test names — the
    // same predicate the `contents` card carries — would silently stop holding.
    const publishSql = only(queries, 'UPDATE experience_locations SET curation_state').sql;
    expect(publishSql).toContain('missing_since IS NULL');
    expect(publishSql).toContain("existence <> 'lost'");
  });

  it('leaves a link the source has withdrawn unread, and the work behind it', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // The same argument as the point above, one table over (ADR-0044): a
    // withdrawn link is shown to nobody, so publishing it looks harmless until
    // the run that places the work here again clears `missing_since` and leaves
    // `curation_state` as this wrote it — a work back on the wall marked as one
    // a curator passed, having been on no card. The work's own publish is scoped
    // through the museum's links, so it carries the term too: a work whose only
    // link here is withdrawn is not on show here, and this card is not the one
    // that should pass it.
    expect(only(queries, 'UPDATE experience_treasures').sql).toContain('missing_since IS NULL');
    expect(only(queries, 'UPDATE treasures').sql).toContain('et.missing_since IS NULL');
  });
});

describe('publishing named contents', () => {
  it('leaves the experience its own state', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto' },
      rowCounts: { 'UPDATE experience_locations SET curation_state': 1 },
    });

    const res = await publish({ locationIds: [11] }, client);

    // A visible museum that gained three checked paintings has not thereby been
    // read: nothing about the container is decided here.
    expect(none(queries, 'UPDATE experiences')).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      curationState: 'auto', locationsPublished: 1, fromSyncLogId: null,
    }));
  });

  it('publishes only the rows named', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'auto' } });

    await publish({ locationIds: [11, 12] }, client);

    const locations = only(queries, 'UPDATE experience_locations SET curation_state');
    expect(locations.sql).toContain('AND id = ANY($2::int[])');
    expect(locations.params[1]).toEqual([11, 12]);
    // The other kind is untouched: naming points says nothing about works.
    expect(none(queries, 'UPDATE experience_treasures')).toBe(true);
  });

  it('publishes a named work through this experience only', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'auto' } });

    await publish({ treasureIds: [900] }, client);

    // The caller's scope was checked against this experience, so an id that
    // belongs to some other museum must not reach that museum's work.
    const works = only(queries, 'UPDATE treasures');
    expect(works.sql).toContain('AND et.treasure_id = ANY($2::int[])');
    expect(works.sql).toContain('et.experience_id = $1');
    expect(only(queries, 'UPDATE experience_treasures').sql)
      .toContain('AND treasure_id = ANY($2::int[])');
    expect(none(queries, 'UPDATE experience_locations SET curation_state')).toBe(true);
  });

  it('does not go looking for a held proposal', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
    });

    await publish({ treasureIds: [900] }, client);

    // The pointer is the object's question, not its contents': answering it
    // here would clear a held proposal nobody looked at.
    expect(none(queries, 'experience_sync_changes')).toBe(true);
    expect(none(queries, 'UPDATE experiences')).toBe(true);
  });
});

/**
 * `{ contentsOnly: true }` — the shape for a card that names no ids at all,
 * because it reports counts rather than the ids behind them. Everything
 * named-contents publishing does for a named subset, this does for every
 * pending row of both kinds at once, while leaving the experience exactly as
 * untouched as naming ids does.
 */
describe('publishing bare contents ({ contentsOnly: true })', () => {
  it('publishes every pending location and treasure, named or not', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto' },
      rowCounts: { 'UPDATE experience_locations SET curation_state': 2, 'UPDATE experience_treasures': 5, 'UPDATE treasures': 5 },
    });

    const res = await publish({ contentsOnly: true }, client);

    expect(only(queries, 'UPDATE experience_locations SET curation_state').sql).not.toContain('ANY($2::int[])');
    expect(only(queries, 'UPDATE experience_treasures').sql).not.toContain('ANY($2::int[])');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      locationsPublished: 2, treasureLinksPublished: 5, treasuresPublished: 5,
    }));
  });

  it('leaves the experience its own state, exactly as named contents does', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    const res = await publish({ contentsOnly: true }, client);

    // The one assertion this whole shape exists to make true: a curator who
    // approved every pending painting has not thereby made a claim about the
    // museum itself (ADR-0025 § 4.4).
    expect(none(queries, 'UPDATE experiences')).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ curationState: 'pending' }));
  });

  it('does not go looking for a held proposal either', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
    });

    await publish({ contentsOnly: true }, client);

    expect(none(queries, 'experience_sync_changes')).toBe(true);
  });

  it('publishes even when the row holds a proposal nobody named, unlike an object publish', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: [] },
      proposal: [{ field: 'name', new: 'X' }],
      rowCounts: { 'UPDATE experience_locations SET curation_state': 1 },
    });

    // No `expectedSyncLogId` at all — this shape has nothing to say about the
    // pointer, and must not be refused for a question it is not answering.
    const res = await publish({ contentsOnly: true }, client);

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(none(queries, 'UPDATE experiences')).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ locationsPublished: 1 }));
  });
});

describe('publishExperienceBodySchema', () => {
  it('reads an empty body as the whole object', () => {
    expect(publishExperienceBodySchema.parse({})).toEqual({});
  });

  it('refuses an empty array, which means neither thing', () => {
    // "Publish exactly nothing, and do not publish the object either" — a card
    // answered with no change made.
    expect(publishExperienceBodySchema.safeParse({ locationIds: [] }).success).toBe(false);
    expect(publishExperienceBodySchema.safeParse({ treasureIds: [] }).success).toBe(false);
  });

  it('refuses a run id beside named contents', () => {
    // A contents publish touches neither the held fields nor the pointer, so
    // accepting the id would let a caller believe it had answered that card.
    expect(publishExperienceBodySchema.safeParse({
      treasureIds: [1], expectedSyncLogId: 53,
    }).success).toBe(false);
    expect(publishExperienceBodySchema.safeParse({ expectedSyncLogId: 53 }).success).toBe(true);
    // Naming rows answers a card, and a held card always names its run (#722):
    // without the pair, a selection at a row whose pointer has been cleared
    // passes every gate and reports success over a card that is not there.
    expect(publishExperienceBodySchema.safeParse({ heldFields: ['name'] }).success).toBe(false);
    expect(publishExperienceBodySchema.safeParse({
      heldParts: [{ kind: 'treasures', ref: 'Q1', name: 'A', fields: ['artist'] }],
    }).success).toBe(false);
    expect(publishExperienceBodySchema.safeParse({
      heldFields: ['name'], expectedSyncLogId: 53,
    }).success).toBe(true);
  });

  it('accepts the bare contentsOnly shape', () => {
    expect(publishExperienceBodySchema.safeParse({ contentsOnly: true }).success).toBe(true);
  });

  it('refuses contentsOnly set to false, which says nothing this schema can mean', () => {
    // There is no meaningful "not contents-only" to send with this field —
    // that is what leaving it absent already means.
    expect(publishExperienceBodySchema.safeParse({ contentsOnly: false }).success).toBe(false);
  });

  it('refuses contentsOnly beside named ids, two ways of saying one thing', () => {
    expect(publishExperienceBodySchema.safeParse({
      contentsOnly: true, locationIds: [1],
    }).success).toBe(false);
    expect(publishExperienceBodySchema.safeParse({
      contentsOnly: true, treasureIds: [1],
    }).success).toBe(false);
  });

  it('refuses contentsOnly beside a run id, which it has no question to answer', () => {
    expect(publishExperienceBodySchema.safeParse({
      contentsOnly: true, expectedSyncLogId: 53,
    }).success).toBe(false);
  });
});
