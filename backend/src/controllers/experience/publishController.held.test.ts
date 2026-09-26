/**
 * Tests for publishing a held proposal: the eleven-field writer really does write the six
 * `accept-source` cannot, a claim is skipped rather than refused, the pointer is cleared —
 * and the object's held fields can be published alone (`{ fieldsOnly: true }`).
 *
 * Every assertion is anchored to the one statement it is about, as
 * `publishController.test.ts` explains: `only()` fails when a fragment matches more than one.
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

import { OBJECT_LOCK } from '../../db/locks.js';
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
  type: 'museum',
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
  type: 'art museum',
  tags: ['new', 'art'],
  // Far enough to count as a move rather than source jitter.
  lon: 4.5, lat: 50.5,
  countryCodes: ['FR', 'BE'],
  countryNames: ['France', 'Belgium'],
  imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/New.jpg',
  metadata: { inDanger: true, dateInscribed: '1980', visitors: 250 },
};

import {
  grantScope, makeClient, mockedConnect, none, only, publish, resetPublishMocks, type Proposed,
} from './publishController.fixtures.js';
import { publishUnderLock } from './publishController.js';

beforeEach(resetPublishMocks);

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
    expect(only(queries, 'UPDATE experience_kind_memberships').sql).toContain('pending_change_sync_log_id = NULL');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fromSyncLogId: 53 }));
  });

  it('publishes only the row a curator named, and keeps the pointer for the rest', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
    });

    const res = await publish({ heldFields: ['name'], expectedSyncLogId: 53 }, client);

    // #722: a run improves and damages in the same breath, so the card answers
    // per field rather than both or neither. What is not named stays open, and
    // the pointer is what keeps it findable — clearing it here would take the
    // description off every screen there is, unanswered.
    const update = only(queries, 'UPDATE experiences');
    expect(update.sql).toContain('name = ');
    expect(update.sql).not.toContain('description = ');
    expect(only(queries, 'UPDATE experience_kind_memberships').sql)
      .not.toContain('pending_change_sync_log_id = NULL');
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
    expect(only(queries, 'UPDATE experience_kind_memberships').sql)
      .toContain('pending_change_sync_log_id = NULL');
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
    // The pointer was cleared while the card was open — somebody else answered
    // it, or a later run withdrew the proposal. Every gate opens on that path:
    // nothing is written, so the staleness check exempts a caller who named no
    // run, and there is no proposal to be missing either. Reporting success
    // would tell the curator they had answered a card that is not there.
    //
    // Sent with no run id, which is the shape that reached the end. The route's
    // schema refuses such a body; the writer refuses it here, because
    // `publishUnderLock` is exported to the batch and the guard has to hold on
    // its own.
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: null },
    });
    mockedConnect.mockResolvedValue(client);

    const outcome = await publishUnderLock(5, 1, null, { heldFields: ['name'] });

    expect(outcome.refusal?.status).toBe(409);
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

    // Not even through COALESCE: the rows that predate the gate carry `published_at`
    // NULL, having been visible for months, and stamping one now would not
    // restart a window but invent one.
    expect(only(queries, 'UPDATE experience_kind_memberships').sql).not.toContain('published_at');
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

  it('takes the lock in a statement of its own and reads the membership in the next', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto', pending_change_sync_log_id: 53 },
      proposal: HELD,
    });

    await publish({ expectedSyncLogId: 53 }, client);

    // A statement's snapshot is taken before it waits for the lock, and only
    // the locked row is re-read once it is granted. The pointer and the state
    // are the membership's (#822), so a read in the locking statement would
    // miss a run that pointed the membership at a newer proposal during the
    // wait — the staleness check would pass on the old pointer and apply that
    // proposal over, losing it (`db/locks.ts`).
    const locked = queries.findIndex(q => q.sql.includes(OBJECT_LOCK));
    expect(queries[locked].sql).toBe(`SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`);
    expect(queries[locked + 1].sql).toContain('m.id AS membership_id');
    expect(queries[locked + 1].sql).not.toContain(OBJECT_LOCK);
    expect(queries[locked + 1].params).toEqual([5]);
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
        { field: 'type', new: 'C', held: true },
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
    for (const column of ['name = ', 'short_description = ', 'description = ', 'type = ', 'image_url = ']) {
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
      ['name', 'description', 'shortDescription', 'type',
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
        // not the gate. A writer reading "held" as "not claimed" would apply
        // this — publishing all eleven columns over a value no card ever showed
        // and no curator ever answered (#519). Unreachable today
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
    const membership = only(queries, 'UPDATE experience_kind_memberships');
    expect(membership.sql).toContain(`curation_state = 'verified'`);
    expect(membership.sql).toContain('pending_change_sync_log_id = NULL');
    expect(only(queries, 'UPDATE experiences').sql).not.toContain('name = ');
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
