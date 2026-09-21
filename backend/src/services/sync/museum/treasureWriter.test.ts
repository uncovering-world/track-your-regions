/**
 * Tests for the works a museum puts on show.
 *
 * Two promises on this path live in a parameter number and a `RETURNING` clause,
 * and neither announces itself when it breaks. A treasure is globally shared, so
 * its `curation_state` cannot be reached through an experience and reads the gate
 * from the museum source, bound positionally as the last of twelve parameters
 * whose other members are mostly numbers — swap it with a sitelink threshold and
 * the statement still runs, still type-checks, and stamps by whether `140`
 * happens to be a gated source id. And the link's `ON CONFLICT DO NOTHING ...
 * RETURNING treasure_id` is the only thing telling "the museum gained a work"
 * from "the run listed one it already had", which is what decides whether a
 * curator's pass over the whole museum is retired.
 *
 * The stamps themselves were proved against a real database in the commit that
 * added them: a gated source writing `pending`, a trusted one writing `auto`,
 * and a stored work keeping the state a curator gave it. What a live run cannot
 * tell apart from luck is which value the gate was reading, and whether a link
 * that was already there counted as an arrival — which is what these pin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/index.js', () => {
  const query = vi.fn();
  return {
    // The membership writes at the end run on a client of their own, holding
    // the museum's lock (`db/locks.ts`). It answers through the same `query`,
    // so a scripted run and the pointer assertions read one stream.
    pool: { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) },
    rollbackQuietly: vi.fn(),
  };
});

vi.mock('../curationDecay.js', () => ({
  retirePassAfterNewContent: vi.fn(),
}));

// The two arms that act on the museum's other links after its works are
// written (ADR-0044). Their SQL is pinned in their own test; what this file
// asks is when the writer reaches for them and with what.
vi.mock('./linkWithdrawal.js', () => ({
  reconcileLinks: vi.fn().mockResolvedValue({ returned: [], withdrawn: [] }),
}));

import { pool, rollbackQuietly } from '../../../db/index.js';
import { retirePassAfterNewContent } from '../curationDecay.js';
import { reconcileLinks } from './linkWithdrawal.js';
import { treasureMetadata, upsertVenueTreasures as writeTreasures } from './treasureWriter.js';
import { ICONIC_SITELINKS, ICONIC_RELEASE } from './tier1.js';
import type { TreasureCredits, TreasureWriteRun } from './treasureWriter.js';
import type { ProcessedContent } from '../types.js';
import type { ImageCredit, StoredCredit } from '../imageCredit.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedRollback = rollbackQuietly as unknown as ReturnType<typeof vi.fn>;
/** The client the last transaction ran on — its `release` says how it ended. */
const lastClient = async () => await mockedConnect.mock.results.at(-1)?.value;
/** Every statement the writer sent, on the pool or on its transaction's client, in order. */
const sentSql = () => mockedQuery.mock.calls.map(c => String(c[0]));

beforeEach(() => {
  // Calls, not the implementation: a test that expects no transaction must not
  // see the one the previous test opened.
  mockedConnect.mockClear();
  mockedRollback.mockReset();
});

/**
 * What a run with nothing to say about photographs hands in.
 *
 * Named rather than defaulted, because the production signature takes credits
 * with no default at all: two empty maps are the one shape that would silently
 * replace every stored credit with `null`, so a caller has to write it down.
 */
const NO_CREDITS: TreasureCredits = { fetched: new Map(), stored: new Map() };

/**
 * A run that can name itself, and that cleared the floor. Named for the reason
 * `NO_CREDITS` is: the production signature takes the run with no default,
 * because a writer that forgot it would hold a visible work's attribution and
 * never point the museum at the run that held it — and, since ADR-0044, would
 * mark links on a run nothing measured.
 */
const RUN: TreasureWriteRun = { syncLogId: 42, withdrawalSkippedReason: null, sourceId: 2 };

const upsertMuseumTreasures = (
  experienceId: number, artworks: ProcessedContent[], credits: TreasureCredits = NO_CREDITS,
  run = RUN, placedElsewhere: string[] = [],
) => writeTreasures(experienceId, artworks, credits, run, placedElsewhere);
const mockedRetire = retirePassAfterNewContent as unknown as ReturnType<typeof vi.fn>;

/** `Art Museums` — the source a treasure's gate is read from. */
const MUSEUM_SOURCE_ID = 2;
const EXPERIENCE_ID = 77;

function artwork(overrides: Partial<ProcessedContent> = {}): ProcessedContent {
  return {
    externalId: 'Q12418',
    name: 'Mona Lisa',
    treasureType: 'painting',
    artists: ['Leonardo da Vinci'],
    year: 1503,
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg',
    sitelinksCount: 140,
    ...overrides,
  };
}

/**
 * Answer the two statements each work sends, in order: the treasure upsert always
 * returns an id, and the link returns a row only when it was really inserted —
 * `DO NOTHING` returns none.
 */
type ScriptedWork = 'new' | 'already linked' | { link: 'new' | 'already linked'; name: string };

function scriptWorks(...links: ScriptedWork[]) {
  scriptStored([]);
  links.forEach((entry, index) => {
    const kind = typeof entry === 'string' ? entry : entry.link;
    const name = typeof entry === 'string' ? 'Mona Lisa' : entry.name;
    mockedQuery.mockResolvedValueOnce({
      // The row the statement wrote. It names the link in `added` — on a claimed
      // field that is the stored value rather than the source's — and nothing
      // else: what the run *compares* is the snapshot above against the source's
      // own offer, which is what lets a refusal read as one.
      // Two columns, because `RETURNING id, name` is two: a fixture carrying the
      // four the clause used to return would let a regression widening it back
      // pass unnoticed.
      rows: [{ id: 900 + index, name }],
    });
    mockedQuery.mockResolvedValueOnce({
      rows: kind === 'new' ? [{ treasure_id: 900 + index }] : [],
    });
  });
}

/** What the museum's works looked like before the run, read once for all of them. */
function scriptStored(rows: unknown[]) {
  mockedQuery.mockResolvedValueOnce({ rows });
}

// One past the snapshot read that now opens the call, so these still name the
// two statements each work sends.
const treasureCall = () => mockedQuery.mock.calls[1];
const linkCall = () => mockedQuery.mock.calls[2];

describe('a work arrives marked as unread', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  it('reads the gate from the museum source, whatever number that parameter takes', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Resolved through the statement rather than asserted as `$12`: the position
    // is not the promise, the value reaching it is. Renumber the list and this
    // still passes; bind the gate to `ICONIC_RELEASE` and it fails.
    const sql = String(treasureCall()[0]);
    const gate = /requires_curation FROM experience_sources WHERE id = \$(\d+)\)/.exec(sql);
    expect(gate, 'the treasure insert no longer reads the gate at all').not.toBeNull();

    const params = treasureCall()[1] as unknown[];
    expect(params[Number(gate![1]) - 1]).toBe(MUSEUM_SOURCE_ID);
  });

  it('binds the source it was told, not a museum constant', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()], NO_CREDITS,
      { syncLogId: 1, withdrawalSkippedReason: null, sourceId: 4 }, []);

    // The same statement as the test above, told a different source: the
    // parameter follows the run rather than a constant this module used to hold.
    const params = treasureCall()[1] as unknown[];
    expect(params).toContain(4);
  });

  it('stamps a work on arrival only, so a pass on a stored work survives the run', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // A treasure is shared by every museum holding it, and a run that found it
    // again has learnt nothing about whether a person has looked at it.
    const sql = String(treasureCall()[0]);
    const onUpdate = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect(sql.slice(0, sql.indexOf('DO UPDATE SET'))).toContain('curation_state');
    // Never assigned on conflict. The hold *reads* it since ADR-0037 — a visible
    // row is what the guards are about — and reading it is not deciding it.
    expect(onUpdate).not.toMatch(/curation_state\s*=/);
  });

  it('keeps the fields a curator claimed, and follows the source everywhere else', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // The same guard an experience's columns carry (#488), a level down: without
    // it a curator who corrects an attribution has it back the source's way after
    // the next run, and nothing anywhere says so happened.
    const onUpdate = String(treasureCall()[0]).slice(String(treasureCall()[0]).indexOf('DO UPDATE SET'));
    for (const column of ['name', 'year', 'image_url']) {
      expect(onUpdate).toContain(`CASE WHEN treasures.curated_fields ? '${column}'`);
    }
    // The makers carry the same claim, on an arm of their own because the column
    // is a list and has a second reason to keep what it holds (below).
    expect(onUpdate).toContain("WHEN treasures.curated_fields ? 'artists'");
    // A count and the threshold read off it are a measurement rather than a
    // judgement, so they stay the source's on every run.
    expect(onUpdate).toContain('sitelinks_count = EXCLUDED.sitelinks_count');
    expect(onUpdate).not.toContain("curated_fields ? 'sitelinks_count'");
    expect(onUpdate).not.toContain("curated_fields ? 'is_iconic'");
  });

  it('keeps the stored order where the source names the same makers in another order', async () => {
    // Stored one way, offered the other: the diff reports nothing, so the row
    // must not move either (#720).
    scriptStored([{
      external_id: 'Q12418', name: 'Mona Lisa',
      artists: ['Ivan Shishkin', 'Konstantin Savitsky'],
      year: 1503, image_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg',
      curated_fields: [],
    }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Mona Lisa' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork({ artists: ['Konstantin Savitsky', 'Ivan Shishkin'] }),
    ]);

    const sql = String(treasureCall()[0]);
    const keep = /WHEN \$(\d+)::boolean THEN treasures\.artists/.exec(
      sql.slice(sql.indexOf('DO UPDATE SET')),
    );
    expect(keep, 'the keep-the-stored-order arm is gone').not.toBeNull();
    expect((treasureCall()[1] as unknown[])[Number(keep![1]) - 1]).toBe(true);
    expect(delta.changed).toEqual([]);
  });

  it('asks the keep-or-replace question the way the diff asks it, not byte for byte', async () => {
    // The reason the answer is computed here rather than as SQL containment: the
    // diff folds case, dashes and whitespace, and array containment does not. A
    // maker whose label gains a typographic edit *and* moves position would
    // otherwise be reported as no change and written anyway — a row moving with
    // nothing recorded, which is what this arm exists to prevent.
    scriptStored([{
      external_id: 'Q12418', name: 'Mona Lisa',
      artists: ['Antonio del Pollaiuolo', 'Piero del Pollaiuolo'],
      year: 1503, image_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg',
      curated_fields: [],
    }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Mona Lisa' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork({ artists: ['piero  del Pollaiuolo', 'Antonio del Pollaiuolo'] }),
    ]);

    const sql = String(treasureCall()[0]);
    const keep = /WHEN \$(\d+)::boolean THEN treasures\.artists/.exec(
      sql.slice(sql.indexOf('DO UPDATE SET')),
    );
    expect((treasureCall()[1] as unknown[])[Number(keep![1]) - 1]).toBe(true);
    expect(delta.changed).toEqual([]);
  });

  it('replaces the makers where a name really was added or dropped', async () => {
    scriptStored([{
      external_id: 'Q12418', name: 'Mona Lisa', artists: ['Ivan Shishkin'],
      year: 1503, image_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg',
      curated_fields: [],
    }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Mona Lisa' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork({ artists: ['Ivan Shishkin', 'Konstantin Savitsky'] }),
    ]);

    const sql = String(treasureCall()[0]);
    const keep = /WHEN \$(\d+)::boolean THEN treasures\.artists/.exec(
      sql.slice(sql.indexOf('DO UPDATE SET')),
    );
    expect((treasureCall()[1] as unknown[])[Number(keep![1]) - 1]).toBe(false);
    expect(delta.changed[0].fields[0]).toMatchObject({ field: 'artists' });
  });

  it('treats a work it has never seen as one to write, not one to keep', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    const sql = String(treasureCall()[0]);
    const keep = /WHEN \$(\d+)::boolean THEN treasures\.artists/.exec(
      sql.slice(sql.indexOf('DO UPDATE SET')),
    );
    expect((treasureCall()[1] as unknown[])[Number(keep![1]) - 1]).toBe(false);
  });

  it('sends the makers as a list, not as a joined string', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork({ artists: ['Ivan Shishkin', 'Konstantin Savitsky'] }),
    ]);

    const params = treasureCall()[1] as unknown[];
    expect(params).toContainEqual(['Ivan Shishkin', 'Konstantin Savitsky']);
    expect(params).not.toContain('Ivan Shishkin, Konstantin Savitsky');
  });

  it('stores a title and its makers as a person would type them', async () => {
    // Wikidata's label for Q2390197 carries two spaces (#835); what the row
    // holds is the name a reader can type into a filter.
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork({ name: 'St. John  on Patmos', artists: [' Hieronymus  Bosch'] }),
    ]);

    const params = treasureCall()[1] as unknown[];
    expect(params).toContain('St. John on Patmos');
    expect(params).toContainEqual(['Hieronymus Bosch']);
  });

  it('reads a link\'s gate through the experience the work is shown in', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Unlike the treasure, a link belongs to one museum, so it can reach the
    // source the way every other content row does.
    const sql = String(linkCall()[0]);
    expect(sql).toMatch(/FROM experiences e JOIN experience_sources c ON c\.id = e\.source_id/);
    expect(sql).toMatch(/WHERE e\.id = \$1/);
    expect(linkCall()[1]).toEqual([EXPERIENCE_ID, 900]);
  });
});

describe('new works retire the pass that covered the museum', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  it('retires the pass when the museum gained a work', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    expect(mockedRetire).toHaveBeenCalledTimes(1);
    // On the client holding the museum's lock, never the pool: the decay
    // chooses rows by their state, and a statement on the pool would choose
    // them under a snapshot older than the lock it waited for (`db/locks.ts`).
    expect(mockedRetire).toHaveBeenCalledWith(await lastClient(), EXPERIENCE_ID);
    const sql = sentSql();
    const lock = sql.indexOf('SELECT id FROM experiences WHERE id = $1 FOR NO KEY UPDATE');
    expect(sql.indexOf('BEGIN')).toBeLessThan(lock);
    expect(lock).toBeLessThan(sql.indexOf('COMMIT'));
    expect(mockedQuery.mock.calls[lock][1]).toEqual([EXPERIENCE_ID]);
    expect((await lastClient()).release).toHaveBeenCalledWith(undefined);
  });

  it('opens no transaction for a museum that gained nothing and holds nothing', async () => {
    scriptWorks('already linked');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    expect(mockedConnect).not.toHaveBeenCalled();
    expect(sentSql()).not.toContain('BEGIN');
  });

  it('retires nothing when every work was already on show', async () => {
    scriptWorks('already linked', 'already linked');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork(), artwork({ externalId: 'Q45585' })]);

    // The whole point of `RETURNING treasure_id` on a `DO NOTHING`: a run that
    // re-lists the same twelve paintings has not changed what is on show, and
    // retiring a curator's pass over it every night would leave the queue saying
    // nothing. Without the returned row this is indistinguishable from an insert.
    expect(mockedRetire).not.toHaveBeenCalled();
  });

  it('retires once for a museum that gained two works, not once per work', async () => {
    scriptWorks('new', 'already linked', 'new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork(),
      artwork({ externalId: 'Q45585' }),
      artwork({ externalId: 'Q19911' }),
    ]);

    // The fact is that the pass no longer covers everything on show, and it is
    // one fact whether one work arrived or twelve.
    expect(mockedRetire).toHaveBeenCalledTimes(1);
  });
});

/**
 * The same `RETURNING` clause, read as news rather than as a trigger.
 *
 * It already knows which works the museum gained; until now it reduced them to a
 * boolean and the names went nowhere, so a run that hung a new Rembrandt in the
 * Rijksmuseum recorded nothing about it (ADR-0026).
 */
describe('the works delta a museum run reports', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  it('names the work the museum gained', async () => {
    scriptWorks('new');

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    expect(delta.added).toEqual([{ name: 'Mona Lisa', ref: 'Q12418' }]);
  });

  it('names only the works that actually arrived', async () => {
    scriptWorks(
      'new',
      { link: 'already linked', name: 'The Night Watch' },
      { link: 'new', name: 'The Starry Night' },
    );

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork(),
      artwork({ externalId: 'Q45585', name: 'The Night Watch' }),
      artwork({ externalId: 'Q19911', name: 'The Starry Night' }),
    ]);

    // A run that re-lists what is already on show adds nothing to the record,
    // the same distinction the retirement above turns on.
    expect(delta.added).toEqual([
      { name: 'Mona Lisa', ref: 'Q12418' },
      { name: 'The Starry Night', ref: 'Q19911' },
    ]);
  });

  it('reports what the run rewrote about a work the museum already held', async () => {
    // The "before" the upsert cannot answer for itself: it is one
    // `INSERT … ON CONFLICT` and `RETURNING` gives back the new values.
    scriptStored([{
      external_id: 'Q12418', name: 'La Gioconda', artists: ['Leonardo'],
      year: 1503, image_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg',
      curated_fields: [],
    }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Mona Lisa' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Named by what it was called before the run, the way every contents record
    // names an item — so the entry stays legible beside a rename.
    expect(delta.changed).toEqual([{
      item: { name: 'La Gioconda', ref: 'Q12418' },
      fields: [
        expect.objectContaining({ field: 'name', old: 'La Gioconda', new: 'Mona Lisa' }),
        expect.objectContaining({ field: 'artists', old: ['Leonardo'], new: ['Leonardo da Vinci'] }),
      ],
    }]);
    // An attribution is the one field here a traveller plans around.
    expect(delta.changed[0].fields.find(f => f.field === 'artists')?.significance).toBe('major');
  });

  it('names a claimed work by what the catalogue calls it, not by the source', async () => {
    scriptStored([{
      external_id: 'Q12418', name: 'La Gioconda', artists: ['Leonardo da Vinci'],
      year: 1503, image_url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg',
      curated_fields: ['name'],
    }]);
    // The claim held, so the statement wrote the stored name back over itself.
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'La Gioconda' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ treasure_id: 900 }] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Reporting the source's title for a link to a work the catalogue calls
    // something else names a work nobody can find.
    expect(delta.added).toEqual([{ name: 'La Gioconda', ref: 'Q12418' }]);
    // And the refusal itself is what a curator is entitled to see rather than a
    // silence: the entry carries the claim that kept the source out. Compared
    // against the source's offer rather than the row the statement wrote — the
    // written row *is* the stored value wherever a claim holds, so comparing
    // against it would report agreement on exactly the fields in dispute.
    expect(delta.changed).toEqual([{
      item: { name: 'La Gioconda', ref: 'Q12418' },
      fields: [expect.objectContaining({
        field: 'name', old: 'La Gioconda', new: 'Mona Lisa', curatedConflict: true,
      })],
    }]);
  });

  it('reports nothing when every work was already on show', async () => {
    scriptWorks('already linked', 'already linked');

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork(),
      artwork({ externalId: 'Q45585' }),
    ]);

    expect(delta).toEqual({ added: [], withdrawn: [], returned: [], changed: [] });
  });

});

/**
 * Who took the picture of the work.
 *
 * Nearly every work in the catalogue shows a photograph served from Wikimedia
 * Commons, and a minority of those are CC BY or CC BY-SA, which of a screen
 * showing a picture ask the photographer's name. What these pin is the half a live run
 * cannot show: that a run which could not reach Commons resends what the row
 * already says rather than dropping it, and that it never writes one
 * photographer's name beside another's photograph.
 */
describe('what a run stores about a work photograph', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  const FILE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg';
  const CREDIT: ImageCredit = {
    author: 'Mbzt',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Mesha_stele.jpg',
  };

  function stored(overrides: Partial<StoredCredit> = {}): Map<string, StoredCredit> {
    return new Map([['Q12418', {
      credit: CREDIT, hasCredit: true, imageUrl: FILE, imageClaimed: false, ...overrides,
    }]]);
  }

  it('stores no picture from a host whose terms do not let us draw it', async () => {
    // The same line an experience's picture is held to (ADR-0043). Every one of
    // the 1324 pictures stored today is a Commons file; this is what notices the
    // day a source answers with something else.
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: 'https://whc.unesco.org/document/141884' })]);

    const upsert = mockedQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO treasures'),
    ) as [string, unknown[]];
    // `$6`, the picture, and `$9`, what is said about it.
    expect(upsert[1][5]).toBeNull();
    expect(upsert[1][8]).toBeNull();
  });

  it('stores no path of ours offered by a run, which only a person may write', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: '/images/experiences/museums/Q12418.jpg' })]);

    const upsert = mockedQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO treasures'),
    ) as [string, unknown[]];
    expect(upsert[1][5]).toBeNull();
  });

  it('writes the credit it just fetched', () => {
    const metadata = treasureMetadata(
      artwork({ imageUrl: FILE }), new Map([[FILE, CREDIT]]), new Map(),
    );

    expect(JSON.parse(metadata!)).toEqual({ imageCredit: CREDIT });
  });

  it('resends the stored credit when Commons could not be reached', () => {
    // The upsert replaces `metadata` whole, so an omitted key is a dropped key:
    // one 5xx would otherwise strip the photographer off every work in the batch.
    const metadata = treasureMetadata(artwork({ imageUrl: FILE }), new Map(), stored());

    expect(JSON.parse(metadata!)).toEqual({ imageCredit: CREDIT });
  });

  it('does not carry a stored credit across to a different photograph', () => {
    const metadata = treasureMetadata(
      artwork({ imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Other.jpg' }),
      new Map(),
      stored(),
    );

    // Naming the wrong person is worse than naming nobody: the source changed
    // the picture and this run could not ask who took the new one.
    expect(metadata).toBeNull();
  });

  it('writes no credit beside a picture a curator claimed', () => {
    const metadata = treasureMetadata(
      artwork({ imageUrl: FILE }),
      new Map([[FILE, CREDIT]]),
      stored({ imageClaimed: true, credit: null, hasCredit: false, imageUrl: 'https://curator.example/photo.jpg' }),
    );

    // `image_url` is in the treasures' claimable set, and the upsert keeps the
    // curator's picture — so writing this run's photographer beside it would
    // print one person's name under another's photograph.
    expect(metadata).toBeNull();
  });

  it('stores nothing at all for a work with no picture', () => {
    // `null` rather than an empty object: some works carry no image, and an object
    // would replace their `null` and report a change to a column nobody reads.
    expect(treasureMetadata(artwork({ imageUrl: null }), new Map(), new Map())).toBeNull();
  });

  it('sends the credit to the upsert as the metadata parameter', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: FILE })], {
      fetched: new Map([[FILE, CREDIT]]), stored: new Map(),
    });

    // Resolved through the statement rather than asserted as `$9`, for the same
    // reason the source gate is: the position is not the promise.
    const sql = String(treasureCall()[0]);
    const columns = /INSERT INTO treasures \(([\s\S]*?)\) VALUES/.exec(sql);
    const index = columns![1].split(',').map(c => c.trim()).indexOf('metadata');
    expect(index, 'the treasure insert no longer writes metadata').toBeGreaterThanOrEqual(0);

    const params = treasureCall()[1] as unknown[];
    expect(JSON.parse(String(params[index]))).toEqual({ imageCredit: CREDIT });
  });

  it('refuses the metadata too where a curator owns the picture, at write time', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: FILE })], {
      fetched: new Map([[FILE, CREDIT]]), stored: new Map(),
    });

    // `treasureMetadata` reads a claim set snapshotted before the collection, and a
    // museum run lasts long enough for a curator to claim `image_url` while it is
    // still going. The row keeps their picture either way; without this the credit
    // beside it would be replaced, printing the source's photographer under a
    // photograph a person chose.
    const onUpdate = String(treasureCall()[0]).slice(String(treasureCall()[0]).indexOf('DO UPDATE SET'));
    // The claim opens the CASE; the gate's term follows it (ADR-0037), pinned
    // by the describe block at the foot. Its THEN arm is the *stored* object —
    // the credit the curator's picture came with — with only the find spot's
    // own rule applied over it.
    expect(onUpdate).toMatch(
      /metadata = CASE WHEN treasures\.curated_fields \? 'image_url'[\s\S]*?THEN NULLIF\(CASE[\s\S]*?COALESCE\(treasures\.metadata, '\{\}'::jsonb\)/,
    );
  });

  it('writes nothing where the run has no credit to write', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: FILE })], {
      fetched: new Map(), stored: new Map(),
    });

    const sql = String(treasureCall()[0]);
    const columns = /INSERT INTO treasures \(([\s\S]*?)\) VALUES/.exec(sql);
    const index = columns![1].split(',').map(c => c.trim()).indexOf('metadata');
    const params = treasureCall()[1] as unknown[];
    expect(params[index]).toBeNull();
  });
});

describe('the line a work is badged at', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  /**
   * The Warka Vase (Q656070, 20 sitelinks on 2026-09-13, typed `container` and
   * so outside the finds pool): a find between the two lines, which is the
   * whole case. Above the archaeology kind's 18 and below the art museums' 22.
   */
  const find = (): ProcessedContent => artwork({
    externalId: 'Q656070',
    name: 'Warka Vase',
    treasureType: 'container',
    artists: [],
    year: null,
    imageUrl: null,
    sitelinksCount: 20,
  });

  /**
   * The flag the insert binds and the two thresholds the update reads, resolved
   * through the statement rather than asserted by position: renumber the list
   * and this still answers, bind the wrong number and it fails.
   */
  function badgeBinding() {
    const sql = String(treasureCall()[0]);
    const params = treasureCall()[1] as unknown[];
    const columns = /INSERT INTO treasures \(([\s\S]*?)\) VALUES/.exec(sql);
    expect(columns, 'the treasure insert no longer names its columns').not.toBeNull();
    const arm = /EXCLUDED\.sitelinks_count >= \$(\d+) THEN true[\s\S]*?EXCLUDED\.sitelinks_count >= \$(\d+)/
      .exec(sql);
    expect(arm, 'the treasure upsert no longer decides is_iconic on two thresholds').not.toBeNull();
    const at = columns![1].split(',').map((c) => c.trim()).indexOf('is_iconic');
    return { flag: params[at], enter: params[Number(arm![1]) - 1], stay: params[Number(arm![2]) - 1] };
  }

  it('badges a find at the line the run states', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [find()], NO_CREDITS, {
      syncLogId: 42,
      withdrawalSkippedReason: null,
      sourceId: 5,
      iconicLine: { enterSitelinks: 18, staySitelinks: 15 },
    });

    // A kind whose finds carry fewer articles than the places showing them
    // states a second pair (ADR-0058 decision 5), and the museum's own badge is
    // read at it. The find's flag has to read the same numbers, or the two
    // badges disagree about the same find (ADR-0023 decision 2).
    expect(badgeBinding()).toEqual({ flag: true, enter: 18, stay: 15 });
  });

  it('badges a work at the art museums\' line where the run states none', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [find()]);

    // The same 20 articles, under the line the museum run has always used: not
    // a masterpiece, and the default is the constants rather than a number this
    // writer invents for a run that said nothing.
    expect(badgeBinding()).toEqual({
      flag: false, enter: ICONIC_SITELINKS, stay: ICONIC_RELEASE,
    });
  });
});

/**
 * Where a find was dug up is the second thing a run stores beside a work, and
 * the only one the reader is told in the same breath as its name: the Rosetta
 * Stone is in London and was found at Fort Julien, and a card that cannot say
 * so describes a display case rather than an object (ADR-0058 decision 3).
 *
 * It rides in the same metadata parameter as the credit, so the two promises
 * are one: a kind that asks where its works come from gets the key, and a kind
 * whose works were made where they hang never sees it — which is what keeps the
 * art and worship runs' rows byte for byte what they were.
 */
describe('what a run stores about where a find was dug up', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  const FILE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Mona%20Lisa.jpg';
  const CREDIT: ImageCredit = {
    author: 'Mbzt',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Mona_Lisa.jpg',
  };

  /** The Rosetta Stone, shown in London and found at Fort Julien. */
  const find = (overrides: Partial<ProcessedContent> = {}): ProcessedContent => artwork({
    externalId: 'Q48584',
    name: 'Rosetta Stone',
    treasureType: 'stele',
    artists: [],
    year: null,
    imageUrl: null,
    sitelinksCount: 90,
    foundAt: { qid: 'Q3077898', label: 'Fort Julien' },
    ...overrides,
  });

  /** What the insert sends as `metadata`, resolved through the statement's own column list. */
  function metadataWritten(): unknown {
    const sql = String(treasureCall()[0]);
    const columns = /INSERT INTO treasures \(([\s\S]*?)\) VALUES/.exec(sql);
    const index = columns![1].split(',').map(c => c.trim()).indexOf('metadata');
    const param = (treasureCall()[1] as unknown[])[index];
    return param === null ? null : JSON.parse(String(param));
  }

  it('sends the find spot to the upsert in the metadata parameter', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [find()]);

    // A work with no picture stores nothing about photographs, and this is
    // still worth a row of metadata: the find spot is a fact about the object.
    expect(metadataWritten()).toEqual({ foundAt: { qid: 'Q3077898', label: 'Fort Julien' } });
  });

  it('stores the find spot beside the credit, not instead of it', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [find({ imageUrl: FILE })], {
      fetched: new Map([[FILE, CREDIT]]), stored: new Map(),
    });

    expect(metadataWritten()).toEqual({
      imageCredit: CREDIT, foundAt: { qid: 'Q3077898', label: 'Fort Julien' },
    });
  });

  it('writes no key for a work whose kind never asks where it was found', async () => {
    scriptWorks('new');

    // The art and worship runs offer no `foundAt` at all, and their rows must
    // read exactly as they did: a key holding nothing is a key a reader has to
    // be told to ignore.
    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: FILE })], {
      fetched: new Map([[FILE, CREDIT]]), stored: new Map(),
    });

    expect(metadataWritten()).toEqual({ imageCredit: CREDIT });
  });

  it('says a find has no spot, rather than saying nothing about it', async () => {
    scriptWorks('new');

    // `null` is what the collector answers where Wikidata states no discovery
    // place, and it is *not* the same as a kind that never asks: this run read
    // the item, so the key is sent holding null and the upsert strips whatever
    // the row was carrying. It is the only way a find spot is ever removed.
    await upsertMuseumTreasures(EXPERIENCE_ID, [find({ foundAt: null })]);

    expect(metadataWritten()).toEqual({ foundAt: null });
  });

  it('stores no find-spot key on a first write, where the null is only a signal', async () => {
    scriptWorks('new');

    // The parameter carries `{ foundAt: null }` (above) because the update arm
    // reads the key as "remove what is stored". On the row's first write there
    // is nothing to remove, so the VALUES arm strips it before the column sees
    // it — a new find with no discovery place is stored with NULL metadata, not
    // with a key that says nothing.
    await upsertMuseumTreasures(EXPERIENCE_ID, [find({ foundAt: null })]);

    const sql = String(treasureCall()[0]);
    // String positions rather than a lazy regex over the whole statement: the
    // VALUES arm is what sits between its opening and the gate's CASE.
    const start = sql.indexOf(') VALUES (');
    const end = sql.indexOf('CASE WHEN (SELECT requires_curation', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const valuesArm = sql.slice(start, end);
    expect(valuesArm).toContain("WHEN $9::jsonb -> 'foundAt' = 'null'::jsonb THEN $9::jsonb - 'foundAt'");
    expect(valuesArm).not.toContain('$8, $9,');
  });

  it('leaves a stored find spot alone when the run offering none writes the work', async () => {
    scriptWorks('already linked');

    // A treasure is global by `external_id` (ADR-0025) and two kinds write the
    // same object: an ancient sculpture in the Louvre is a work of the Art
    // Museums run and a find of the Archaeology run. The art run sends no key,
    // and the statement merges the stored spot back rather than replacing the
    // object whole — otherwise the two runs would take the find spot off each
    // other's row on every pass.
    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: FILE })], {
      fetched: new Map([[FILE, CREDIT]]), stored: new Map(),
    });

    const onUpdate = String(treasureCall()[0]).slice(
      String(treasureCall()[0]).indexOf('DO UPDATE SET'),
    );
    // No key: the stored spot is merged back in.
    expect(onUpdate).toContain(
      "jsonb_build_object('foundAt', treasures.metadata -> 'foundAt')",
    );
    // The key holding JSON null: it is stripped.
    expect(onUpdate).toContain("- 'foundAt'");
    // And the claim guard still chooses which object is kept.
    expect(onUpdate).toContain("metadata = CASE WHEN treasures.curated_fields ? 'image_url'");
  });

  it('reports a moved find spot the way it reports a moved credit', async () => {
    // Until now a discovery place could arrive, change or go away with nothing
    // in the record: a curator reading a gated source's changeset saw the work
    // and not the ground it came out of (#887). The entry is the credit's shape,
    // and the "after" is the source's offer like every other entry here.
    scriptStored([{
      external_id: 'Q48584', name: 'Rosetta Stone', artists: [], year: null,
      image_url: null, curated_fields: [],
      found_at: { qid: 'Q3077898', label: 'Fort Julien' },
    }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Rosetta Stone' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [find({
      foundAt: { qid: 'Q13217298', label: 'Rashid' },
    })]);

    expect(delta.changed[0].fields).toContainEqual({
      field: 'metadata.foundAt',
      old: { qid: 'Q3077898', label: 'Fort Julien' },
      new: { qid: 'Q13217298', label: 'Rashid' },
      significance: 'minor',
      curatedConflict: false,
      held: false,
    });
  });

  it('reports a find spot taken away, which is the only way one ever goes', async () => {
    scriptStored([{
      external_id: 'Q48584', name: 'Rosetta Stone', artists: [], year: null,
      image_url: null, curated_fields: [],
      found_at: { qid: 'Q3077898', label: 'Fort Julien' },
    }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Rosetta Stone' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [find({ foundAt: null })]);

    expect(delta.changed[0].fields).toContainEqual(expect.objectContaining({
      field: 'metadata.foundAt', old: { qid: 'Q3077898', label: 'Fort Julien' }, new: null,
    }));
  });

  it('says nothing about a find spot a run of another kind never read', async () => {
    // The art and worship runs offer no key, the upsert keeps what the row
    // holds, and an entry here would report a change nobody made.
    scriptStored([{
      external_id: 'Q12418', name: 'Mona Lisa', artists: [], year: null,
      image_url: null, curated_fields: [],
      found_at: { qid: 'Q3077898', label: 'Fort Julien' },
    }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Mona Lisa' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    const fields = delta.changed[0]?.fields ?? [];
    expect(fields.map((f) => f.field)).not.toContain('metadata.foundAt');
  });

  it('lets the find spot follow the source through a curator\'s picture claim', async () => {
    scriptWorks('already linked');

    // The claim is about a photograph; the find spot is about the object. Frozen
    // behind the claim, a P189 correction would never reach a work whose picture
    // a curator once chose, and the card would name the wrong ground for as long
    // as the claim stood. So the guard still decides *which object* is kept — the
    // stored one, credit and all — and the find spot's own three-state rule is
    // applied over it in both arms.
    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork({ imageUrl: FILE })], {
      fetched: new Map([[FILE, CREDIT]]), stored: new Map(),
    });

    const onUpdate = String(treasureCall()[0]).slice(
      String(treasureCall()[0]).indexOf('DO UPDATE SET'),
    );
    const claimArm = onUpdate.slice(
      onUpdate.indexOf("metadata = CASE WHEN treasures.curated_fields ? 'image_url'"),
      onUpdate.indexOf('updated_at = NOW()'),
    );
    // The claimed arm rebuilds from the stored object, never from the run's.
    expect(claimArm).toMatch(/THEN NULLIF\(CASE[\s\S]*?COALESCE\(treasures\.metadata, '\{\}'::jsonb\)/);
    // Both arms strip and replace the one key, and both ask the run's own
    // *parameter* what it said about it — never EXCLUDED, which is the evaluated
    // VALUES row and has had a null key stripped by then (INSERTED_METADATA), so
    // read there the remove signal is gone before the arm sees it. The base only
    // decides what the answer applies to.
    expect(claimArm.match(/COALESCE\(treasures\.metadata, '\{\}'::jsonb\) - 'foundAt'/g)).toHaveLength(1);
    expect(claimArm.match(/COALESCE\(EXCLUDED\.metadata, '\{\}'::jsonb\) - 'foundAt'/g)).toHaveLength(1);
    expect(claimArm.match(/\$9::jsonb -> 'foundAt' = 'null'::jsonb/g)).toHaveLength(2);
    expect(claimArm.match(/COALESCE\(\$9::jsonb, '\{\}'::jsonb\) \? 'foundAt'/g)).toHaveLength(2);
    expect(claimArm).not.toMatch(/EXCLUDED\.metadata -> 'foundAt'/);
    expect(claimArm).not.toMatch(/EXCLUDED\.metadata, '\{\}'::jsonb\) \? 'foundAt'/);
  });
});

/**
 * A gated source may not overwrite what a reader can already see, and since
 * ADR-0037 that covers a work's fields as it has always covered the museum's
 * own. Measured before this existed: run 64 rewrote the attribution of The Wine
 * Glass (Gemäldegalerie) from Johannes Vermeer to an obscure namesake, live,
 * under a gated source, with nobody asked (#717). The row's own state decides
 * visibility — a work verified through one venue is on show there even where
 * another venue's link is still pending.
 */
describe('a visible work under a gated source', () => {
  const FILE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Wine%20Glass.jpg';
  const NEW_FILE = 'http://commons.wikimedia.org/wiki/Special:FilePath/Wine%20Glass%202.jpg';
  const CREDIT: ImageCredit = {
    author: 'Mbzt', license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    detailsUrl: 'https://commons.wikimedia.org/wiki/File:Wine_Glass.jpg',
  };
  const NEW_CREDIT: ImageCredit = { ...CREDIT, author: 'Someone Else' };
  const POINTER = /SET pending_change_sync_log_id/;

  /** The Wine Glass as stored, and the source's offer against it. */
  const GLASS = {
    external_id: 'Q12418', name: 'The Wine Glass', artists: ['Johannes Vermeer'],
    year: 1660, image_url: FILE, image_credit: CREDIT, curated_fields: [] as string[],
  };
  const offer = (overrides: Partial<ProcessedContent> = {}) => artwork({
    name: 'The Wine Glass', artists: ['Jan Vermeer van Haarlem the Elder'], year: 1660, imageUrl: FILE,
    ...overrides,
  });

  /** One stored work, the upsert's answer about the hold, and a link already there. */
  function scriptHeld(wasHeld: boolean, stored: Partial<typeof GLASS> = {}) {
    scriptStored([{ ...GLASS, ...stored }]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'The Wine Glass', was_held: wasHeld }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
  }

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  it('keeps every field a curator could be asked about where the row is visible and gated', async () => {
    scriptHeld(true);

    await upsertMuseumTreasures(EXPERIENCE_ID, [offer()]);

    const sql = String(treasureCall()[0]);
    const onUpdate = sql.slice(sql.indexOf('DO UPDATE SET'));
    // The gate, bound as the same parameter the insert reads it from, and the
    // row's own state — never the link's, and never EXCLUDED's.
    const gate = "OR ((SELECT requires_curation FROM experience_sources WHERE id = $12)";
    for (const column of ['name', 'year', 'image_url']) {
      expect(onUpdate, column).toContain(`${column} = CASE WHEN treasures.curated_fields ? '${column}' ${gate}`);
    }
    expect(onUpdate).toContain(`WHEN treasures.curated_fields ? 'artists' ${gate}`);
    expect(onUpdate).toContain("AND treasures.curation_state <> 'pending')");
    expect(onUpdate).not.toContain('EXCLUDED.curation_state');
    // The credit follows its picture — held with it, or the row would name the
    // source's photographer under the photograph the hold just kept — and *only*
    // with it: a credit fetched for the picture the row already shows is the
    // row's own, and holding it would leave every visible work under a gated
    // museum unable to gain a credit for as long as the gate stands, with
    // nothing recorded and no card to apply it from (the review of #717).
    expect(onUpdate).toContain(
      `metadata = CASE WHEN treasures.curated_fields ? 'image_url'\n                             OR (${gate.slice(3)}`,
    );
    // The stored object kept, with only the find spot's own rule applied over
    // it: the credit is the picture's and is held with it, the find spot is the
    // source's and is not (#887 is what is left frozen — today the credit).
    expect(onUpdate).toMatch(
      /AND treasures\.image_url IS DISTINCT FROM EXCLUDED\.image_url\)\s+THEN NULLIF\(CASE/,
    );
    // The guard's own answer, on the row the statement locked.
    expect(sql).toMatch(/RETURNING id, name,[\s\S]*AS was_held/);
    // Still outside every guard: a count and a threshold on it are measurements.
    expect(onUpdate).toContain('sitelinks_count = EXCLUDED.sitelinks_count');
  });

  it('reports the re-attribution as held and points the museum at the run', async () => {
    scriptHeld(true);

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [offer()]);

    expect(delta.changed).toEqual([{
      item: { name: 'The Wine Glass', ref: 'Q12418' },
      fields: [expect.objectContaining({
        field: 'artists', old: ['Johannes Vermeer'], new: ['Jan Vermeer van Haarlem the Elder'],
        significance: 'major', held: true, curatedConflict: false,
      })],
    }]);
    const pointer = sentSql().find(s => POINTER.test(s));
    expect(pointer).toBeDefined();
    const call = mockedQuery.mock.calls.find(c => POINTER.test(String(c[0])));
    expect(call?.[1]).toEqual([EXPERIENCE_ID, 42]);
    // Under the museum's lock, taken first in a statement of its own, and
    // released by COMMIT: a lock folded into the UPDATE would choose the
    // membership under the pre-wait snapshot (`db/locks.ts`).
    const sql = sentSql();
    const begin = sql.indexOf('BEGIN');
    const lock = sql.indexOf('SELECT id FROM experiences WHERE id = $1 FOR NO KEY UPDATE');
    const pointerAt = sql.findIndex(s => POINTER.test(s));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(begin);
    expect(pointerAt).toBeGreaterThan(lock);
    expect(sql.indexOf('COMMIT')).toBeGreaterThan(pointerAt);
    expect(mockedQuery.mock.calls[lock][1]).toEqual([EXPERIENCE_ID]);
  });

  it('rolls back and rethrows when the pointer cannot be written, releasing the client as marked', async () => {
    scriptHeld(true);
    const failure = new Error('deadlock detected');
    mockedQuery.mockImplementation(async (sql: string) => {
      if (POINTER.test(sql)) throw failure;
      return { rows: [] };
    });
    mockedRollback.mockResolvedValueOnce(failure);

    await expect(upsertMuseumTreasures(EXPERIENCE_ID, [offer()])).rejects.toBe(failure);

    const client = await lastClient();
    expect(mockedRollback).toHaveBeenCalledWith(client);
    expect(sentSql()).not.toContain('COMMIT');
    // What rollbackQuietly hands back is what release is told: a client whose
    // ROLLBACK also failed must be destroyed, not pooled.
    expect(client.release).toHaveBeenCalledWith(failure);
  });

  it('carries the new picture\'s credit beside a held picture, so publishing can credit it', async () => {
    scriptHeld(true);

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [offer({ artists: ['Johannes Vermeer'], imageUrl: NEW_FILE })], {
      fetched: new Map([[NEW_FILE, NEW_CREDIT]]), stored: new Map(),
    });

    expect(delta.changed[0].fields).toEqual([
      expect.objectContaining({ field: 'image_url', old: FILE, new: NEW_FILE, held: true }),
      expect.objectContaining({ field: 'metadata.imageCredit', old: CREDIT, new: NEW_CREDIT, held: true }),
    ]);
  });

  it('carries no credit entry where the picture did not change', async () => {
    scriptHeld(true);

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [offer()], {
      fetched: new Map([[FILE, NEW_CREDIT]]), stored: new Map(),
    });

    // A credit refreshed for the same photograph is the row tidying itself, not
    // a picture a curator is asked about.
    expect(delta.changed[0].fields.map(f => f.field)).toEqual(['artists']);
  });

  it('writes the re-attribution and points at nothing where the row is not held', async () => {
    scriptHeld(false);

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [offer()]);

    expect(delta.changed[0].fields[0]).toMatchObject({ field: 'artists', held: false });
    expect(sentSql().filter(s => POINTER.test(s))).toEqual([]);
  });

  it('points at nothing for a run that cannot name itself', async () => {
    scriptHeld(true);

    await upsertMuseumTreasures(EXPERIENCE_ID, [offer()], NO_CREDITS,
      { syncLogId: null, withdrawalSkippedReason: null, sourceId: 2 });

    expect(sentSql().filter(s => POINTER.test(s))).toEqual([]);
  });

  it('lets a claim win over the hold on the field it covers', async () => {
    scriptHeld(true, { curated_fields: ['artists'] });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [offer({ year: 1661 })]);

    expect(delta.changed[0].fields).toEqual([
      expect.objectContaining({ field: 'artists', curatedConflict: true, held: false }),
      expect.objectContaining({ field: 'year', curatedConflict: false, held: true }),
    ]);
  });
});

/**
 * When the writer reaches for the museum's other links, and with what (ADR-0044).
 *
 * The order is the safety and the floor is the gate, and neither is visible in
 * the delta a caller reads: a writer that reconciled before the last work was
 * written, or marked on a run that had not cleared the floor, would return the
 * same shape as one that did it right.
 */
describe('the links of works a run no longer places here', () => {
  const mockedReconcile = reconcileLinks as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
    mockedReconcile.mockReset();
    mockedReconcile.mockResolvedValue({ returned: [], withdrawn: [] });
  });

  const SHORT: TreasureWriteRun = {
    syncLogId: 42,
    withdrawalSkippedReason: 'this run placed 291 of the 1301 works the catalogue offers at the '
      + '100 museums it admits (22.4%), below the 90% floor',
    sourceId: 2,
  };

  it('compares the museum against every work the run offered, by the id the upsert answered', async () => {
    scriptWorks('new', { link: 'already linked', name: 'The Night Watch' });

    await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork(), artwork({ externalId: 'Q45585', name: 'The Night Watch' }),
    ]);

    // Both works, arrived or already linked: what the run offers is what it
    // listed, and a work it re-listed is not one it stopped placing here.
    expect(mockedReconcile).toHaveBeenCalledWith(EXPERIENCE_ID, expect.objectContaining({
      offered: [900, 901], withdraw: true,
    }));
  });

  it('marks nothing on a run that did not clear the floor, and still restores', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()], NO_CREDITS, SHORT);

    // Floor first, withdrawal second: run 42 with a withdrawal arm is the
    // failure this whole change exists to prevent. The reconciliation still
    // runs — restoring is never what a short run gets wrong — told not to mark.
    expect(mockedReconcile).toHaveBeenCalledWith(EXPERIENCE_ID, expect.objectContaining({
      offered: [900], withdraw: false,
    }));
  });

  it('hands over the works this run places elsewhere, so a moved work is held rather than lost', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()], NO_CREDITS, RUN, ['Q45585', 'Q19911']);

    expect(mockedReconcile).toHaveBeenCalledWith(EXPERIENCE_ID, expect.objectContaining({
      placedElsewhere: ['Q45585', 'Q19911'],
    }));
  });

  it('reconciles only after every work is written', async () => {
    scriptStored([]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900, name: 'Mona Lisa' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ treasure_id: 900 }] });
    mockedQuery.mockRejectedValueOnce(new Error('connection reset'));

    await expect(upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork(), artwork({ externalId: 'Q45585', name: 'The Night Watch' }),
    ])).rejects.toThrow('connection reset');

    // A museum whose write threw part-way keeps every link: nothing is marked
    // on the strength of a list the run did not finish.
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it('reports what the arms marked and restored, named, beside what arrived', async () => {
    scriptWorks('new');
    mockedReconcile.mockResolvedValueOnce({
      withdrawn: [{ name: 'Ophelia', ref: 'Q1246930' }],
      returned: [{ name: 'The Syndics', ref: 'Q2379280' }],
    });

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    expect(delta).toEqual({
      added: [{ name: 'Mona Lisa', ref: 'Q12418' }],
      withdrawn: [{ name: 'Ophelia', ref: 'Q1246930' }],
      returned: [{ name: 'The Syndics', ref: 'Q2379280' }],
      changed: [],
    });
  });

  it('does not retire the pass for a work given its place back', async () => {
    // Arrivals only, as with a point: a returned work was on show when the
    // pass was made, and the row a curator looked at is the same row.
    scriptWorks('already linked');
    mockedReconcile.mockResolvedValueOnce({
      returned: [{ name: 'Mona Lisa', ref: 'Q12418' }], withdrawn: [],
    });

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    expect(mockedRetire).not.toHaveBeenCalled();
  });
});
