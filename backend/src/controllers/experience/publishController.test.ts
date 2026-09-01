/**
 * Tests for publishing — the answer to the three cards a gated source raises.
 *
 * The rules worth pinning are the ones nothing in the column names implies: an
 * arrival takes its contents with it while named contents leave the object
 * alone, the eleven-field writer really does write the six `accept-source`
 * cannot, a claim is skipped rather than refused, the pointer is cleared, and
 * `published_at` is not stamped onto a row a reader could already see.
 *
 * Every assertion is anchored to the one statement it is about. Two predicates
 * on this branch have already survived deletion under a green suite because an
 * assertion matched a sibling statement, so `only()` fails when a fragment
 * matches more than one.
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
  assignRegionsForExperiences, worldViewsWithGeometry,
} from '../../services/sync/regionAssignmentService.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import { publishExperienceBodySchema } from '../../types/index.js';
import { computeChangeSet, type ExperienceSnapshot } from '../../services/sync/changeSet.js';

/**
 * Two snapshots that differ in every field the differ knows how to report, so
 * `computeChangeSet` can be asked what a run is capable of proposing rather than
 * the answer being retyped here.
 */
const BEFORE_SNAPSHOT: ExperienceSnapshot = {
  name: 'Old Name',
  nameLocal: { en: 'Old Name' },
  description: 'Old description',
  shortDescription: 'Old short',
  category: 'museum',
  tags: ['old'],
  lon: 4, lat: 50,
  countryCodes: ['FR'],
  countryNames: ['France'],
  imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Old.jpg',
  metadata: { inDanger: false, dateInscribed: '1979', visitors: 100 },
};

const CHANGED_SNAPSHOT: ExperienceSnapshot = {
  name: 'New Name',
  nameLocal: { en: 'New Name', fr: 'Nouveau' },
  description: 'New description',
  shortDescription: 'New short',
  category: 'art museum',
  tags: ['new', 'art'],
  // Far enough to count as a move rather than source jitter.
  lon: 4.5, lat: 50.5,
  countryCodes: ['FR', 'BE'],
  countryNames: ['France', 'Belgium'],
  imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/New.jpg',
  metadata: { inDanger: true, dateInscribed: '1980', visitors: 250 },
};

import {
  CURATOR, grantScope, makeClient, mockedConnect, mockedQuery, none, noWrites, only, publish,
  type Proposed,
} from './publishController.fixtures.js';

const mockedPlace = assignRegionsForExperiences as unknown as ReturnType<typeof vi.fn>;
const mockedWorldViews = worldViewsWithGeometry as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
  mockedPlace.mockReset();
  mockedPlace.mockResolvedValue(3);
  mockedWorldViews.mockReset();
  mockedWorldViews.mockResolvedValue([1, 4]);
});

describe('publishing an arrival', () => {
  it('publishes the object and everything unread it holds', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending' },
      rowCounts: { 'UPDATE experience_locations SET curation_state': 2, 'UPDATE experience_treasures': 12, 'UPDATE treasures': 12 },
    });

    const res = await publish({}, client);

    // The row itself, and the two states that make it visible.
    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain(`curation_state = 'verified'`);
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
    expect(only(queries, 'UPDATE experiences').sql)
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
    // Both terms of `offeredLocationSql`, because one of them is satisfied by the
    // bare predicate this used to carry: asserting `missing_since IS NULL` alone stays
    // green if the existence term is reverted, and the invariant this test names — the
    // same predicate the `contents` card carries — would silently stop holding.
    const publishSql = only(queries, 'UPDATE experience_locations SET curation_state').sql;
    expect(publishSql).toContain('missing_since IS NULL');
    expect(publishSql).toContain("existence <> 'lost'");
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

describe('publishing a held proposal', () => {
  const HELD: Proposed[] = [
    { field: 'name', new: 'Museo Nacional del Prado', held: true },
    { field: 'description', new: 'Longer text', held: true },
  ];

  it('clears the pointer, which is what makes the card answerable', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    // Until this endpoint existed only a later run proposing nothing at all
    // ever cleared it, so a `held` card had no answer.
    expect(only(queries, 'UPDATE experiences').sql).toContain('pending_change_sync_log_id = NULL');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fromSyncLogId: 53 }));
  });

  it('publishes only the row a curator named, and keeps the pointer for the rest', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
    });

    const res = await publish({ heldFields: ['name'], expectedSyncLogId: 53 }, client);

    // #722: a run improves and damages in the same breath, and the card's one
    // button used to take both or neither. What is not named stays open, and
    // the pointer is what keeps it findable — clearing it here would take the
    // description off every screen there is, unanswered.
    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain('name = ');
    expect(update.sql).not.toContain('description = ');
    expect(update.sql).not.toContain('pending_change_sync_log_id = NULL');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: ['name'], heldLeftOpen: 1,
    }));
  });

  it('records what it published, so the card it leaves standing stops offering it', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
    });

    await publish({ heldFields: ['name'], expectedSyncLogId: 53 }, client);

    // The run's own record still says the field was held — what a changeset
    // holds is what happened — so without this row the card that keeps its
    // pointer would go on proposing a value it has already applied.
    const insert = only(queries, 'INSERT INTO experience_held_decisions');
    expect(insert.params).toContain('published');
    expect(insert.params).toContain(JSON.stringify('Museo Nacional del Prado'));
  });

  it('leaves a row somebody already answered alone, even on a whole-card publish', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
      answered: [{ kind: null, ref: null, name: null, field: 'description' }],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    // Refused last week. Publishing the card must not write it back: the answer
    // is by value, and this is the same value.
    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain('name = ');
    expect(update.sql).not.toContain('description = ');
    // Nothing else was left open, so the card goes.
    expect(update.sql).toContain('pending_change_sync_log_id = NULL');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ appliedFields: ['name'] }));
  });

  it('refuses a selection that reaches nothing rather than reporting success', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
      answered: [{ kind: null, ref: null, name: null, field: 'name' }],
    });

    const res = await publish({ heldFields: ['name'], expectedSyncLogId: 53 }, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(none(queries, 'UPDATE experiences')).toBe(true);
  });

  it('refuses a selection at a row that is holding nothing', async () => {
    grantScope();
    // The pointer was cleared while the card was open — somebody else answered
    // it, or a later run withdrew the proposal. Every gate opens on that path:
    // nothing is written, so the staleness check exempts a caller who named no
    // run, and there is no proposal to be missing either. Reporting success
    // would tell the curator they had answered a card that is not there.
    //
    // Sent with no run id, which is the shape that reached the end. The schema
    // refuses such a body over HTTP; the writer refuses it here, because
    // `publishUnderLock` is exported and the guard has to hold on its own.
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: null },
    });

    const res = await publish({ heldFields: ['name'] }, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(none(queries, 'UPDATE experiences')).toBe(true);
  });

  it('names held rows without releasing the unread contents under them', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
      rowCounts: { 'UPDATE experience_locations SET curation_state': 4 },
    });

    const res = await publish({ heldFields: ['name'], expectedSyncLogId: 53 }, client);

    // Naming held rows is a fields publish, the way naming ids is a contents
    // one: answering one sentence must not put four unread points on the map
    // as a side effect (#524).
    expect(none(queries, 'UPDATE experience_locations SET curation_state')).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ locationsPublished: 0 }));
  });

  it('never restarts an already-visible object\'s New-chip window', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
    });

    await publish({ expectedSyncLogId: 53 }, client);

    // Not even through COALESCE: 1576 rows predate the gate with `published_at`
    // NULL, having been visible for months, and stamping one now would not
    // restart a window but invent one.
    expect(only(queries, 'UPDATE experiences').sql).not.toContain('published_at');
  });

  it('reads the proposal under the lock that writes it', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
    });

    await publish({ expectedSyncLogId: 53 }, client);

    // Resolved before the lock, a run landing in between would have its values
    // written under the run id the curator sent.
    expect(queries[0].sql).toBe('BEGIN');
    const locked = queries.findIndex(q => q.sql.includes(OBJECT_LOCK));
    const lookup = queries.findIndex(q => q.sql.includes('experience_sync_changes'));
    const write = queries.findIndex(q => q.sql.includes('UPDATE experiences'));
    expect(locked).toBeLessThan(lookup);
    expect(lookup).toBeLessThan(write);
    // The pointer decides which run's proposal is applied, not "the newest".
    // Named by the proposal read rather than by the table, since the answers
    // already standing against that proposal are read off the same table (#722).
    expect(only(queries, 'SELECT changed_fields').params).toEqual([5, 53]);
  });

  it('writes all eleven content fields, not the five accept-source can', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, metadata: { a: 1 } },
      proposal: [
        { field: 'name', new: 'N', held: true },
        { field: 'nameLocal', new: { en: 'N' }, held: true },
        { field: 'description', new: 'D', held: true },
        { field: 'shortDescription', new: 'S', held: true },
        { field: 'category', new: 'C', held: true },
        { field: 'tags', new: ['ancient'], held: true },
        { field: 'location', new: { lon: 1.5, lat: -2.5 }, held: true },
        { field: 'countryCodes', new: ['FR'], held: true },
        { field: 'countryNames', new: ['France'], held: true },
        { field: 'imageUrl', new: 'http://commons.wikimedia.org/wiki/Special:FilePath/Proposed.jpg', held: true },
        { field: 'metadata', old: { a: 1 }, new: { a: 2 }, held: true },
      ],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    // The six `accept-source` releases instead of writing. Under a gate that
    // escape is closed — the next run holds the value too — so a field missing
    // here would be proposed for ever and applied never.
    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain('name_local = ');
    expect(update.sql).toContain('tags = ');
    expect(update.sql).toContain('location = ST_SetSRID(ST_MakePoint(');
    expect(update.sql).toContain('country_codes = ');
    expect(update.sql).toContain('country_names = ');
    expect(update.sql).toContain('metadata = ');
    // And the five it can, so the writer is a superset rather than an alternative.
    for (const column of ['name = ', 'short_description = ', 'description = ', 'category = ', 'image_url = ']) {
      expect(update.sql).toContain(column);
    }
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: expect.arrayContaining(['nameLocal', 'tags', 'location', 'countryCodes', 'countryNames', 'metadata']),
    }));
  });

  it('writes every field a run can actually propose', async () => {
    // The differ is the side that decides what a `held` card can carry, and
    // `CURATED_KEY_BY_FIELD` is the side that could be missing an entry — so the
    // list is taken from `computeChangeSet` and fed back in as the proposal,
    // values and all. Iterating the map would prove the wrong direction: add a
    // field to `collectDifferences` without adding it to the map and the map
    // still looks complete, while every card carrying that field answers 409 for
    // ever, the pointer never clears, and the curator cannot dismiss it by any
    // route.
    // Diffed as a gated run over an already-visible row, which is the only run
    // that produces a held card at all — so the proposal fed back in is the
    // record such a run writes, `held` flags and all (#519).
    const diff = computeChangeSet(BEFORE_SNAPSHOT, CHANGED_SNAPSHOT, [], true);
    const proposal = diff.heldFields;
    const names = proposal.map(field => field.field);
    // Nothing may have slipped into the applied bucket, or this test would be
    // feeding the writer fields no card ever showed.
    expect(diff.changedFields).toEqual([]);
    // A guard on the fixture, not on the code: a snapshot pair that stopped
    // differing everywhere would quietly narrow what this test covers. `tags`
    // is not in the list because no run proposes it any more (#570); the test
    // below keeps the writer able to apply the rows earlier runs filed.
    expect(names).toEqual(expect.arrayContaining(
      ['name', 'description', 'shortDescription', 'category',
        'location', 'countryCodes', 'countryNames', 'imageUrl']));
    // Metadata arrives one key at a time, never as a catch-all: a key is a fact
    // and a fact is answered on its own. So what has to be writable is each key
    // by name, which is also the direction that catches a key the differ can
    // propose and the writer cannot apply.
    expect(names).toEqual(expect.arrayContaining(
      ['metadata.inDanger', 'metadata.dateInscribed', 'metadata.visitors']));
    expect(names).not.toContain('metadata');
    // And the local names one language at a time, for the same reason (#728) —
    // `fr` arriving beside a corrected `en`, which is the pair a curator has to
    // be able to answer separately. The stored map is fed to the writer below
    // with the rest of the row, since publishing a language merges it onto what
    // is stored rather than assigning the run's whole map.
    expect(names).toEqual(expect.arrayContaining(['nameLocal.en', 'nameLocal.fr']));
    expect(names).not.toContain('nameLocal');
    expect(names).not.toContain('tags');

    grantScope();
    const { client } = makeClient({
      row: {
        curation_state: 'auto', pending_change_sync_log_id: 53,
        metadata: BEFORE_SNAPSHOT.metadata, name_local: BEFORE_SNAPSHOT.nameLocal,
      },
      proposal,
    });
    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: expect.arrayContaining(names),
    }));
  });

  it('still writes a tags row a run filed before tags stopped being held', async () => {
    // 3785 such rows sit in this database's log. A changeset records what its run
    // did (ADR-0026), and a card a curator publishes writes what that run
    // proposed — the writer keeps its `tags` arm for them even though no run
    // files one now (#570).
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: [] },
      proposal: [{ field: 'tags', old: [], new: ['criterion_ii', 'criterion_iv'], held: true }],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain('tags = ');
    // The value, not only the assignment: an arm that bound nothing would still
    // read `tags = ` and apply an empty list over the proposal.
    expect(update.params).toContain(JSON.stringify(['criterion_ii', 'criterion_iv']));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ appliedFields: ['tags'] }));
  });

  it('leaves a field the curator claims alone, and publishes anyway', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: ['name'] },
      proposal: HELD,
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    // Publishing answers "may readers see this", the claim answers "whose text
    // is it". Both can be open at once, so a claim is skipped by the writer and
    // is not a reason to refuse the request.
    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain('description = ');
    expect(update.sql).not.toContain('name = ');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: ['description'], claimedFieldsSkipped: ['name'],
    }));
  });

  it('writes only what the gate held, not a field refused for another reason', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: [] },
      proposal: [
        // Neither flag: a field some future refusal kept out for a reason that is
        // not the gate. The writer used to read "held" as "not claimed", so this
        // would have been applied — publishing all eleven columns over a value no
        // card ever showed and no curator ever answered (#519). Unreachable today
        // and deliberately so: the flag is what keeps it unreachable tomorrow.
        { field: 'name', new: 'Refused for some other reason' },
        { field: 'description', new: 'D', held: true },
      ],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(only(queries, 'UPDATE experiences').sql).not.toContain('name = ');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ appliedFields: ['description'] }));
  });

  it('leaves a field the run itself refused to accept-source', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: [] },
      proposal: [
        { field: 'name', new: 'From the source', curatedConflict: true, held: false },
        { field: 'description', new: 'D', held: true },
      ],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    // The queue's `held` card filters on the same flag, so writing a
    // `curatedConflict` field here would apply something no card offered — and
    // `accept-source`, which owns that question, would find it already applied.
    expect(only(queries, 'UPDATE experiences').sql).not.toContain('name = ');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ appliedFields: ['description'] }));
  });

  it('publishes an object publish with no expectedSyncLogId when the only held field is claimed', async () => {
    // The bug this staleness fix removes: a pointer is set, but its one held
    // field is one the curator already claimed, so the queue's `held` card
    // excludes it from what it shows — the card the frontend reads to know
    // whether to send `expectedSyncLogId` at all. The card has no held half,
    // so the frontend legitimately sends `{}`, and before this fix that 409ed
    // for ever, with no run id the curator could ever discover to send.
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: ['name'] },
      proposal: [{ field: 'name', new: 'X', held: true }],
    });

    const res = await publish({}, client);

    expect(res.status).not.toHaveBeenCalledWith(409);
    // Nothing was applied — the only held field was claimed — but the row is
    // still marked read and the stale pointer still clears, since a fully
    // claimed proposal has nothing further to hold onto.
    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain(`curation_state = 'verified'`);
    expect(update.sql).toContain('pending_change_sync_log_id = NULL');
    expect(update.sql).not.toContain('name = ');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: [], claimedFieldsSkipped: ['name'], fromSyncLogId: 53,
    }));
  });
});

/**
 * `{ fieldsOnly: true }` — the mirror, and what #524 asked for.
 *
 * A museum whose label is held *and* which gained twelve paintings could be
 * answered only as one act, so declining the label held back the paintings: one
 * doubtful field freezing twelve works, which is the failure ADR-0025's queue
 * section named from the other direction.
 */
describe('publishing only the object\'s held fields ({ fieldsOnly: true })', () => {
  it('applies the held fields and leaves every unread point and work alone', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: [] },
      // `held: true` is what makes a proposed field one the gate refused and a
      // publication can apply; without it there is nothing here to publish.
      proposal: [{ field: 'name', new: 'Museo Nacional del Prado', held: true }],
      rowCounts: { 'UPDATE experience_locations SET curation_state': 2, 'UPDATE experience_treasures': 12 },
    });

    const res = await publish({ fieldsOnly: true, expectedSyncLogId: 53 }, client);

    // The object's own row is written — that is what was answered — and the two
    // contents statements are never sent, so the counts are zero rather than
    // whatever those rowCounts would have made them.
    expect(only(queries, 'UPDATE experiences').sql).toContain('name');
    expect(none(queries, 'UPDATE experience_locations SET curation_state')).toBe(true);
    expect(none(queries, 'UPDATE experience_treasures')).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      appliedFields: ['name'],
      locationsPublished: 0, treasureLinksPublished: 0, treasuresPublished: 0,
    }));
  });

  it('refuses to publish only the fields of an object nobody has passed', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    const res = await publish({ fieldsOnly: true }, client);

    // Otherwise the arrival reaches readers with every point and work still
    // `pending` — an object in every list with nothing on the map, which is the
    // failure the writer's deferral machinery exists to prevent, arriving through
    // the one shape that skips `publishContents`.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(none(queries, 'UPDATE experiences')).toBe(true);
  });

  it('records which of the three publishes it was, since the numbers cannot say', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53, curated_fields: [] },
      proposal: [{ field: 'name', new: 'X', held: true }],
    });

    await publish({ fieldsOnly: true, expectedSyncLogId: 53 }, client);

    // An object publish that happened to hold no unread contents writes the same
    // zeros as this does, so the trail says which act it was in words.
    const log = only(queries, 'experience_curation_log');
    expect(JSON.parse(String(log.params[3])).scope).toBe('fields');
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

describe('refusing to publish', () => {
  it('refuses a curator whose scope does not reach the experience', async () => {
    grantScope();
    mockedQuery.mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] });
    const { client } = makeClient({ row: { curation_state: 'pending' } });

    const res = await publish({}, client, CURATOR);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('refuses when the pointer names a run whose changeset is not on record', async () => {
    grantScope();
    // Pointer set, no `experience_sync_changes` row for it: `recordSyncChanges`
    // writes a run's whole changeset as one batched insert, so a run whose
    // pointer landed and whose changeset did not is a reachable failure, and
    // the admin screen has an alert for exactly it.
    // `proposal` omitted is how this helper says "no changeset row", which is
    // the state under test — distinct from `proposal: []`, a row whose proposal
    // is empty.
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 500 },
    });

    const res = await publish({ expectedSyncLogId: 500 }, client);

    // Not 200-with-nothing-applied: that would clear the pointer, take the card
    // away and report success, leaving the held values unwritten and no record
    // that anything was held. `accept-source` refuses the same case, and two
    // endpoints disagreeing about it is worse than either answer alone.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(noWrites(queries)).toBe(true);
  });

  it('answers 404 for a row that vanished before the lock', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: null });

    const res = await publish({}, client);

    // The existence check ran on another connection and earlier in time.
    // Reading `curated_fields` off nothing would answer 500 to a 404.
    expect(res.status).toHaveBeenCalledWith(404);
    expect(noWrites(queries)).toBe(true);
  });

  it('names the run now holding the row when the card was stale', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 61 },
      proposal: [{ field: 'name', new: 'X', held: true }],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('different run'), pendingChangeSyncLogId: 61,
    }));
    expect(noWrites(queries)).toBe(true);
  });

  it('refuses when a proposal arrived under a caller that expected none', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending', pending_change_sync_log_id: 61 },
      // A real, writable, unclaimed field — the row genuinely has something
      // left to answer, unlike the fully-claimed case the staleness check
      // now skips. Without this the fixture proves nothing under the new
      // check: an empty proposal writes nothing either way, and the refusal
      // this test is about would not fire for that reason instead. `held: true`
      // is required for `heldFieldWrites` to count it at all — it now reads the
      // field's own flag rather than inferring "held" from "not a claim" (#519).
      proposal: [{ field: 'name', new: 'X', held: true }],
    });

    const res = await publish({}, client);

    // Publishing here would either apply values the curator never saw or clear
    // the pointer without applying them, and the second loses the proposal.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(noWrites(queries)).toBe(true);
  });

  it('refuses when the proposal it was holding has gone', async () => {
    grantScope();
    const { client } = makeClient({ row: { curation_state: 'auto', pending_change_sync_log_id: null } });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('is gone'), pendingChangeSyncLogId: null,
    }));
  });

  it('refuses rather than publish around a coordinate it cannot read', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: [
        { field: 'location', new: { lon: 'east', lat: null }, held: true },
        { field: 'name', new: 'N', held: true },
      ],
    });

    const res = await publish({ expectedSyncLogId: 53 }, client);

    // Publishing the name and clearing the pointer would drop the coordinate
    // silently, and ST_MakePoint(NULL, NULL) would fail the transaction with an
    // error naming neither the field nor the reason. The message has to name the
    // field, or a curator is told only that publishing failed.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('location'),
    }));
    expect(noWrites(queries)).toBe(true);
  });

  it('asks the locked read for every column a decision here rests on', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // The one assertion in this file that has to be about the statement's text
    // rather than its effect. The mocked client answers `FOR UPDATE` with a full
    // row whatever the SELECT actually named, so a column dropped from that list
    // is invisible to every other test here while being `undefined` in
    // production — the refused-row guard silently stops firing, the claim filter
    // stops skipping, the pointer reads as "nothing held", and `published_at`
    // stops being stamped. Proved by mutation: removing `admission` from the
    // list killed no test until this one existed.
    const locked = only(queries, OBJECT_LOCK);
    for (const column of [
      'curation_state', 'curated_fields', 'metadata', 'admission', 'pending_change_sync_log_id',
    ]) {
      expect(locked.sql, `the locked read does not select ${column}`).toContain(column);
    }
  });

  it('refuses to publish a row the category turned down', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending', admission: 'refused' },
    });

    const res = await publish({}, client);

    // ADR-0025 decision 4: admission is asked before publication, so publishing
    // a refused row asks the second question first. Left unrefused, the row
    // leaves `arrivals` for ever — nothing returns a `verified` row to `pending`
    // — and a later override would put it in front of readers with nobody having
    // reviewed its contents.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('turned down'),
    }));
    expect(noWrites(queries)).toBe(true);
  });

  it('refuses a contents publish on a row the category turned down', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', admission: 'refused' },
    });

    const res = await publish({ locationIds: [11] }, client);

    // A refused museum's unread paintings raise no `contents` card either —
    // that query carries `hideRefusedSql()` on the container — so this path
    // must refuse for the same reason and not only the object path.
    expect(res.status).toHaveBeenCalledWith(409);
    expect(noWrites(queries)).toBe(true);
  });

  it('publishes a row the category admitted', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'pending', admission: 'admitted' },
    });

    const res = await publish({}, client);

    // The other direction, or the guard above could be an unconditional refusal.
    expect(res.status).not.toHaveBeenCalled();
    expect(only(queries, 'UPDATE experiences').sql).toContain(`curation_state = 'verified'`);
  });

  it('destroys a client whose rollback also failed', async () => {
    grantScope();
    const { client } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 61 },
    });
    const inner = client.query.getMockImplementation()!;
    const rollbackFailure = new Error('connection terminated mid-rollback');
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'ROLLBACK') throw rollbackFailure;
      return inner(sql, params);
    });

    await publish({ expectedSyncLogId: 53 }, client);

    // `pg-pool` keeps a released client unless the argument is truthy, so a
    // client whose ROLLBACK failed while the socket still works would go back to
    // the idle pool carrying an open transaction — and the next request would
    // run inside it. `release()` with no argument is the bug this pins.
    expect(client.release).toHaveBeenCalledWith(rollbackFailure);
  });

  it('finishes rolling back before letting go of the client', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 61 },
    });
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

    await publish({ expectedSyncLogId: 53 }, client);

    // A non-awaited `return refuse(…)` settles the try block immediately, so
    // `finally` releases the client mid-ROLLBACK — and reads `unusable` before
    // it has been assigned.
    expect(releasedBeforeRollback).toBe(false);
  });
});

describe('publishing does not re-place the object', () => {
  it('touches no region assignment', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // Placement's insert predicate is the `offeredLocationSql` pair — the withdrawal
    // flag and the `lost` verdict — and nothing else, so a `pending` location was
    // already placed by the run that wrote it
    // and flipping it to `verified` moves nothing. This guards an addition
    // rather than a deletion: "publish places" reads as the obvious symmetry,
    // and doing it would delete and reinsert region rows across every world view
    // with geometry for no change at all.
    expect(none(queries, 'experience_location_regions')).toBe(true);
    expect(none(queries, 'experience_regions')).toBe(true);
    expect(mockedQuery).toHaveBeenCalledTimes(1);   // the existence check, nothing after
    // The one exception is a released withdrawal, and this publish released
    // none. Asserted on the service rather than on the SQL, because placement
    // runs off its own connection and issues no statement on this client.
    expect(mockedPlace).not.toHaveBeenCalled();
  });
});

/**
 * The one publish that changes where an object is.
 *
 * A moved point under a gated source is a withdrawal the run held back and an
 * arrival nobody can see (`locationWriter.ts`). Publishing the arrival is the
 * moment the two swap, and it has to happen in one transaction or the point
 * exists twice or not at all.
 */
describe('publishing releases the withdrawal that was waiting on it', () => {
  /** A publish that made an unread point visible, and released one withdrawal. */
  const releasing = () => makeClient({
    row: { curation_state: 'pending' },
    rowCounts: {
      'UPDATE experience_locations SET curation_state': 1,
      'SET missing_since = NOW()': 1,
    },
  });

  it('withdraws the old point the published one was holding', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    const release = only(queries, 'SET missing_since = NOW()');
    // Read off the arrival rather than searched for: the column is on the new
    // row and names the old one, so publishing reads the pairing from the row it
    // is publishing.
    expect(release.sql).toContain('arrived.withdrawal_deferred_for_location_id = old.id');
    // Only a pairing whose arrival a reader can now see. Before the statement
    // above ran, this one would match nothing.
    expect(release.sql).toContain(`arrived.curation_state <> 'pending'`);
    // Never a second time, and never over a point some other path already
    // withdrew.
    expect(release.sql).toContain('old.missing_since IS NULL');
    // Both sides scoped to this experience. The writer never pairs across
    // objects, and the foreign key does not say so, so this is the one statement
    // here that could otherwise reach a row the caller's scope was not checked
    // against.
    expect(release.sql).toContain('arrived.experience_id = $1');
    expect(release.sql).toContain('old.experience_id = $1');
    expect(release.params[0]).toBe(5);
  });

  it('does it inside the transaction that published the point', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // The whole reason this was deferred out of the writer's own sub-branch: on
    // either side of a COMMIT the map shows the place twice or not at all.
    const publishing = queries.findIndex(q => q.sql.includes('UPDATE experience_locations SET curation_state'));
    const release = queries.findIndex(q => q.sql.includes('SET missing_since = NOW()'));
    expect(publishing).toBeLessThan(release);
    expect(release).toBeLessThan(queries.findIndex(q => q.sql === 'COMMIT'));
  });

  it('leaves no waiter on the point it withdraws', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // The floor under `locationWriter`'s prevention, and it belongs in the same
    // `SET` list as the withdrawal rather than in the clear two statements below:
    // that one skips rows still `pending`, which is exactly what a released
    // intermediate is. Without this, a chain P <- A1 <- A2 survives publishing A2 —
    // A1 is withdrawn but keeps naming P, A1 can never be published
    // (`missing_since IS NULL`), nothing deletes a location so the foreign key
    // never fires, and P stays visible beside A2 for ever.
    expect(only(queries, 'SET missing_since = NOW()').sql)
      .toContain('withdrawal_deferred_for_location_id = NULL');
  });

  it('lets go of the pairing it has just released', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // A pairing left standing outlives its purpose and turns harmful: a run that
    // offers the old point again clears `missing_since`, and the next run to
    // withdraw it would find the stale pointer and hold it for ever, with no
    // arrival left to publish.
    //
    // Keyed on `IS NOT NULL`, which only this statement carries: the release's own
    // `SET` clears the column too, so a fragment naming the assignment alone now
    // depends on where the line happens to wrap.
    const clear = only(queries, 'withdrawal_deferred_for_location_id IS NOT NULL');
    expect(clear.sql).toContain('SET withdrawal_deferred_for_location_id = NULL');
    expect(clear.sql).toContain(`curation_state <> 'pending'`);
    const release = queries.findIndex(q => q.sql.includes('SET missing_since = NOW()'));
    expect(queries.indexOf(clear)).toBeGreaterThan(release);
  });

  it('places the object again, because a point stopped being offered', async () => {
    grantScope();
    const { client } = releasing();

    const res = await publish({}, client);

    // The one publish that genuinely moves geometry. Placement's insert carries
    // the `offeredLocationSql` pair while its clear does not, so the released
    // point's region rows have to go — and only a full re-place can recompute
    // the experience-level union they fed.
    expect(mockedPlace).toHaveBeenCalledWith([5], 1);
    expect(mockedPlace).toHaveBeenCalledWith([5], 4);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ withdrawalsReleased: 1 }));
  });

  it('places after the commit, on a connection of its own', async () => {
    grantScope();
    const { client, queries } = releasing();
    let committed = false;
    const inner = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'COMMIT') committed = true;
      return inner(sql, params);
    });
    // Recorded and asserted afterwards, never `expect`ed inside the mock: this
    // call is wrapped in the try/catch that turns a placement failure into a
    // reported one, so a failed assertion in here is swallowed and the test
    // passes. Proved by mutation — moving the COMMIT after the placement killed
    // no test until this was recorded instead of asserted.
    let placedBeforeCommit = false;
    mockedPlace.mockImplementation(async () => {
      if (!committed) placedBeforeCommit = true;
      return 3;
    });

    await publish({}, client);

    // `assignRegionsForExperiences` opens a transaction of its own, so calling it
    // from inside this one would have it wait on rows this transaction holds.
    expect(mockedPlace).toHaveBeenCalled();
    expect(placedBeforeCommit).toBe(false);
    expect(queries.some(q => q.sql.includes('experience_location_regions'))).toBe(false);
  });

  it('tries every world view, even after one of them fails', async () => {
    grantScope();
    const { client } = releasing();
    mockedPlace.mockImplementation(async (_ids: number[], worldViewId: number) => {
      if (worldViewId === 1) throw new Error('world view 1 is busy');
      return 3;
    });

    const res = await publish({}, client);

    // Each world view is its own transaction over its own regions, so one failing
    // says nothing about the next. Stopping at the first would leave the rest
    // stale with nothing naming them.
    expect(mockedPlace).toHaveBeenCalledWith([5], 1);
    expect(mockedPlace).toHaveBeenCalledWith([5], 4);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ placementFailed: true }));
  });

  it('names the world views left stale, because the curator cannot re-place them', async () => {
    grantScope();
    const { client } = releasing();
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: 'GADM' }] });
    mockedPlace.mockImplementation(async (_ids: number[], worldViewId: number) => {
      if (worldViewId === 1) throw new Error('world view 1 is busy');
      return 3;
    });

    const res = await publish({}, client);

    // Re-assignment is admin-only, and this endpoint's caller is usually a scoped
    // curator. A boolean plus a line in this process's log leaves them telling an
    // admin "something about regions failed on the Prado", so the answer names
    // each one: the name for the person reading it, the id for the admin they
    // take it to. Only the failures — world view 4 placed and is not in here.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailed: true,
      placementFailedWorldViews: [{ id: 1, name: 'GADM' }],
    }));
  });

  it('answers with the ids when the world views cannot be named', async () => {
    grantScope();
    const { client } = releasing();
    mockedQuery.mockRejectedValueOnce(new Error('name lookup failed'));
    mockedPlace.mockRejectedValue(new Error('regions are busy'));

    const res = await publish({}, client);

    // The name is cosmetic and the id is the answer. Failing the whole call over
    // the lookup would report a publication that landed as an error.
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailedWorldViews: [{ id: 1, name: null }, { id: 4, name: null }],
    }));
  });

  it('says nothing failed when the world views cannot even be listed', async () => {
    grantScope();
    const { client } = releasing();
    mockedWorldViews.mockRejectedValue(new Error('no connection'));

    const res = await publish({}, client);

    // A different sentence from a named world view refusing: nothing was placed at
    // all. It must still not throw, and must still not claim success — and it is
    // the one failure with no world view to name, which the page says in those
    // words rather than printing "world view null".
    expect(mockedPlace).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailed: true,
      placementFailedWorldViews: [{ id: null, name: null }],
    }));
  });

  it('does not undo the publication when placing afterwards fails', async () => {
    grantScope();
    const { client, queries } = releasing();
    mockedPlace.mockRejectedValue(new Error('regions are busy'));

    const res = await publish({}, client);

    // The publication is committed by then. Throwing here would answer 500 to a
    // curator whose click did land, and the catch above would run ROLLBACK on a
    // transaction that no longer exists.
    expect(queries.at(-1)?.sql).toBe('COMMIT');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      withdrawalsReleased: 1, placementFailed: true,
    }));
  });

  it('says in the audit row how many withdrawals it released', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // The publication's own record. A reader looking at why a pin moved has the
    // audit row and nothing else — the run that proposed the move is a different
    // row in a different table, and says nothing about when it took effect.
    expect(JSON.parse(String(only(queries, 'INSERT INTO experience_curation_log').params[3])))
      .toMatchObject({ withdrawalsReleased: 1 });
  });

  it('asks nothing and places nothing when it published no point', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'auto' } });

    await publish({ treasureIds: [900] }, client);

    // A pairing only ever sits on a `pending` point, so a publish that moved no
    // point cannot have released one. Two statements and two placement
    // transactions per treasures-only publish, for nothing.
    expect(none(queries, 'SET missing_since = NOW()')).toBe(true);
    expect(none(queries, 'SET withdrawal_deferred_for_location_id = NULL')).toBe(true);
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it('leaves a withdrawn point unread even when the caller names it', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto' },
      rowCounts: { 'UPDATE experience_locations SET curation_state': 1 },
    });

    await publish({ locationIds: [11] }, client);

    // The named path needs the guard as much as the "all" path does, and it is
    // the same statement — asserted separately because a `($2 IS NULL OR …)`
    // rewrite, or a named-only branch, is exactly how the two would come apart.
    // A point published while withdrawn reappears on the map already `verified`
    // the next time a run offers it, having been on no card at any point.
    const locations = only(queries, 'UPDATE experience_locations SET curation_state');
    // Both terms of the fragment, for the reason the "all" path's assertion gives:
    // one of them is satisfied by the narrower predicate this replaced, so pinning it
    // alone would leave a revert green on both paths.
    expect(locations.sql).toContain('missing_since IS NULL');
    expect(locations.sql).toContain("existence <> 'lost'");
    expect(locations.sql).toContain('AND id = ANY($2::int[])');
    expect(locations.params[1]).toEqual([11]);
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
