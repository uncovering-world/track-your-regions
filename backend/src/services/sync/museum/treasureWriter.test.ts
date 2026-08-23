/**
 * Tests for the works a museum puts on show.
 *
 * Two promises on this path live in a parameter number and a `RETURNING` clause,
 * and neither announces itself when it breaks. A treasure is globally shared, so
 * its `curation_state` cannot be reached through an experience and reads the gate
 * from the museum category, bound positionally as the last of twelve parameters
 * whose other members are mostly numbers — swap it with a sitelink threshold and
 * the statement still runs, still type-checks, and stamps by whether `140`
 * happens to be a gated category id. And the link's `ON CONFLICT DO NOTHING ...
 * RETURNING treasure_id` is the only thing telling "the museum gained a work"
 * from "the run listed one it already had", which is what decides whether a
 * curator's pass over the whole museum is retired.
 *
 * The stamps themselves were proved against a real database in the commit that
 * added them: a gated category writing `pending`, a trusted one writing `auto`,
 * and a stored work keeping the state a curator gave it. What a live run cannot
 * tell apart from luck is which value the gate was reading, and whether a link
 * that was already there counted as an arrival — which is what these pin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  pool: { query: vi.fn() },
  db: {},
}));

vi.mock('../curationDecay.js', () => ({
  retirePassAfterNewContent: vi.fn(),
}));

import { pool } from '../../../db/index.js';
import { retirePassAfterNewContent } from '../curationDecay.js';
import { treasureMetadata, upsertMuseumTreasures as writeTreasures } from './treasureWriter.js';
import type { TreasureCredits } from './treasureWriter.js';
import type { ProcessedContent } from '../types.js';
import type { ImageCredit, StoredCredit } from '../imageCredit.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/**
 * What a run with nothing to say about photographs hands in.
 *
 * Named rather than defaulted, because the production signature takes credits
 * with no default at all: two empty maps are the one shape that would silently
 * replace every stored credit with `null`, so a caller has to write it down.
 */
const NO_CREDITS: TreasureCredits = { fetched: new Map(), stored: new Map() };

const upsertMuseumTreasures = (
  experienceId: number, artworks: ProcessedContent[], credits: TreasureCredits = NO_CREDITS,
) => writeTreasures(experienceId, artworks, credits);
const mockedRetire = retirePassAfterNewContent as unknown as ReturnType<typeof vi.fn>;

/** `Top Art Museums` — the category a treasure's gate is read from. */
const MUSEUM_CATEGORY_ID = 2;
const EXPERIENCE_ID = 77;

function artwork(overrides: Partial<ProcessedContent> = {}): ProcessedContent {
  return {
    externalId: 'Q12418',
    name: 'Mona Lisa',
    treasureType: 'painting',
    artist: 'Leonardo da Vinci',
    year: 1503,
    imageUrl: 'https://upload.wikimedia.org/mona-lisa.jpg',
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

  it('reads the gate from the museum category, whatever number that parameter takes', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Resolved through the statement rather than asserted as `$12`: the position
    // is not the promise, the value reaching it is. Renumber the list and this
    // still passes; bind the gate to `ICONIC_RELEASE` and it fails.
    const sql = String(treasureCall()[0]);
    const gate = /requires_curation FROM experience_categories WHERE id = \$(\d+)\)/.exec(sql);
    expect(gate, 'the treasure insert no longer reads the gate at all').not.toBeNull();

    const params = treasureCall()[1] as unknown[];
    expect(params[Number(gate![1]) - 1]).toBe(MUSEUM_CATEGORY_ID);
  });

  it('stamps a work on arrival only, so a pass on a stored work survives the run', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // A treasure is shared by every museum holding it, and a run that found it
    // again has learnt nothing about whether a person has looked at it.
    const sql = String(treasureCall()[0]);
    const onUpdate = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect(sql.slice(0, sql.indexOf('DO UPDATE SET'))).toContain('curation_state');
    expect(onUpdate).not.toContain('curation_state');
  });

  it('keeps the fields a curator claimed, and follows the source everywhere else', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // The same guard an experience's columns carry (#488), a level down: without
    // it a curator who corrects an attribution has it back the source's way after
    // the next run, and nothing anywhere says so happened.
    const onUpdate = String(treasureCall()[0]).slice(String(treasureCall()[0]).indexOf('DO UPDATE SET'));
    for (const column of ['name', 'artist', 'year', 'image_url']) {
      expect(onUpdate).toContain(`CASE WHEN treasures.curated_fields ? '${column}'`);
    }
    // A count and the threshold read off it are a measurement rather than a
    // judgement, so they stay the source's on every run.
    expect(onUpdate).toContain('sitelinks_count = EXCLUDED.sitelinks_count');
    expect(onUpdate).not.toContain("curated_fields ? 'sitelinks_count'");
    expect(onUpdate).not.toContain("curated_fields ? 'is_iconic'");
  });

  it('reads a link\'s gate through the experience the work is shown in', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Unlike the treasure, a link belongs to one museum, so it can reach the
    // category the way every other content row does.
    const sql = String(linkCall()[0]);
    expect(sql).toMatch(/FROM experiences e JOIN experience_categories c ON c\.id = e\.category_id/);
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
    expect(mockedRetire).toHaveBeenCalledWith(pool, EXPERIENCE_ID);
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
      external_id: 'Q12418', name: 'La Gioconda', artist: 'Leonardo',
      year: 1503, image_url: 'https://upload.wikimedia.org/mona-lisa.jpg',
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
        expect.objectContaining({ field: 'artist', old: 'Leonardo', new: 'Leonardo da Vinci' }),
      ],
    }]);
    // An attribution is the one field here a traveller plans around.
    expect(delta.changed[0].fields.find(f => f.field === 'artist')?.significance).toBe('major');
  });

  it('names a claimed work by what the catalogue calls it, not by the source', async () => {
    scriptStored([{
      external_id: 'Q12418', name: 'La Gioconda', artist: 'Leonardo da Vinci',
      year: 1503, image_url: 'https://upload.wikimedia.org/mona-lisa.jpg',
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

  it('never reports a withdrawn work, because nothing unlinks one yet', async () => {
    scriptWorks('new');

    const delta = await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // ADR-0026 decision 5: the shape admits a withdrawal and this path must not
    // produce one until a contents coverage floor exists. Run 42 returned 291
    // artworks where the run before it returned 1906 and reported success — with
    // unlinking in place that run would have taken two thirds of the catalogue's
    // works off the walls.
    expect(delta.withdrawn).toEqual([]);
    expect(delta.returned).toEqual([]);
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
    // reason the category gate is: the position is not the promise.
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
    expect(onUpdate).toMatch(
      /metadata = CASE WHEN treasures\.curated_fields \? 'image_url'\s+THEN treasures\.metadata ELSE EXCLUDED\.metadata END/,
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
