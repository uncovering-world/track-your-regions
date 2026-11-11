import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations } from './locationWriter.js';
import { upsertVenueTreasures } from './museum/treasureWriter.js';
import type { ContentsDelta, ProcessedContent } from './types.js';

/**
 * A point's or a work's change on a refused membership (#2393), executed
 * against PostgreSQL, since each part's hold is decided in SQL and the pointer
 * under the place's lock: asked by the kind that placed the part where some
 * kind offers the place, since readers see the part there, and by nobody
 * where no kind does.
 *
 * Two fixtures, as the dev catalogue held them on 2026-11-09. The Cave of
 * Altamira is refused by Public art and offered by Archaeology, each kind with
 * a point of its own. The Museum of Fine Arts Ghent is refused by Art Museums
 * and offered by no kind, and Art Museums' runs kept proposing Bosch's *Christ
 * Carrying the Cross* as of 1515 rather than 1510. Every source is gated. Ids
 * are the fixtures' own, deleted before and after.
 */

const ALTAMIRA = 9480;
const ALTAMIRA_QID = 'Q9480-altamira-parts-fixture';
const GHENT = 9490;
const GHENT_QID = 'Q9490-msk-ghent-fixture';
const WORK_QID = 'Q9490-christ-carrying-the-cross-fixture';

const pointOf = (source: string) => ({ externalRef: `Q9480-${source}`, lon: -4.11975, lat: 43.376944 });

const WORK: ProcessedContent = {
  externalId: WORK_QID,
  name: 'Christ Carrying the Cross',
  treasureType: 'painting',
  artists: ['Hieronymus Bosch'],
  year: 1510,
  imageUrl: null,
  sitelinksCount: 20,
};

type Source = { id: number; kind_id: number };
type Admission = 'admitted' | 'refused';
let sources: Record<'publicArt' | 'archaeology' | 'artMuseums', Source>;
/** Each source's run log: the pointer a run sets names its own run. */
let logs: Record<number, number> = {};

async function sourceNamed(name: string): Promise<Source> {
  const result = await pool.query<Source>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1 AND requires_curation', [name],
  );
  expect(result.rowCount).toBe(1);
  return result.rows[0];
}

async function clear(): Promise<void> {
  const ids = Object.values(logs);
  await pool.query(
    'UPDATE source_records SET pending_change_sync_log_id = NULL WHERE experience_id = ANY($1::int[])',
    [[ALTAMIRA, GHENT]],
  );
  if (ids.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [ids]);
  logs = {};
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [WORK_QID]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[ALTAMIRA, GHENT]]);
}

/** The place, with each kind's membership as the test sets it: admitted or refused, passed by a curator. */
async function place(id: number, qid: string, name: string, memberships: [Source, Admission][]): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(-4.11975, 43.376944), 4326))`,
    [id, memberships[0][0].id, qid, name],
  );
  for (const [source, admission] of memberships) {
    await pool.query(
      `INSERT INTO source_records
         (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
       VALUES ($1, $2, $3, $4, $5, 'verified', NOW())`,
      [id, source.kind_id, source.id, qid, admission],
    );
    logs[source.id] ??= (await pool.query<{ id: number }>(
      `INSERT INTO experience_sync_logs (source_id, status, started_at, is_dry_run)
       VALUES ($1, 'running', NOW(), FALSE) RETURNING id`, [source.id],
    )).rows[0].id;
  }
}

const pointers = async (id: number) => Object.fromEntries((await pool.query<{ source_id: number; pointer: number | null }>(
  'SELECT source_id, pending_change_sync_log_id AS pointer FROM source_records WHERE experience_id = $1', [id],
)).rows.map(row => [row.source_id, row.pointer]));

const asked = (delta: ContentsDelta) => delta.changed.flatMap(entry => entry.fields.filter(f => f.held).map(f => f.field));

/** A point each kind wrote for the cave, published by a curator. */
async function altamira(publicArt: Admission, archaeology: Admission): Promise<void> {
  await place(ALTAMIRA, ALTAMIRA_QID, 'Cave of Altamira', [[sources.publicArt, publicArt], [sources.archaeology, archaeology]]);
  for (const [key, source] of [['public-art', sources.publicArt], ['archaeology', sources.archaeology]] as const) {
    await writeExperienceLocations(ALTAMIRA, [{ ...pointOf(key), name: 'Cave of Altamira' }], { syncLogId: null, sourceId: source.id });
  }
  await pool.query("UPDATE experience_locations SET curation_state = 'verified' WHERE experience_id = $1", [ALTAMIRA]);
}

const renamed = (key: string, source: Source) => writeExperienceLocations(
  ALTAMIRA, [{ ...pointOf(key), name: 'Altamira Cave' }], { syncLogId: logs[source.id], sourceId: source.id },
);

const pointNames = async () => (await pool.query<{ name: string }>(
  'SELECT DISTINCT name FROM experience_locations WHERE experience_id = $1', [ALTAMIRA],
)).rows.map(row => row.name);

/** The work at the museum, published by a curator, as each kind's run placed it. */
async function ghent(kinds: [Source, Admission][]): Promise<void> {
  await place(GHENT, GHENT_QID, 'Museum of Fine Arts Ghent', kinds);
  for (const [source] of kinds) await works(source, WORK);
  await pool.query("UPDATE treasures SET curation_state = 'verified' WHERE external_id = $1", [WORK_QID]);
  await pool.query("UPDATE experience_treasures SET curation_state = 'verified' WHERE experience_id = $1", [GHENT]);
}

const works = (source: Source, work: ProcessedContent) => upsertVenueTreasures(
  GHENT, [work], { fetched: new Map(), stored: new Map() },
  { syncLogId: logs[source.id], withdrawalSkippedReason: 'a fixture of one work', sourceId: source.id }, [],
);

const year = async () => (await pool.query<{ year: number }>(
  'SELECT year FROM treasures WHERE external_id = $1', [WORK_QID],
)).rows[0].year;

beforeEach(async () => {
  await clear();
  sources = {
    publicArt: await sourceNamed('Public art'),
    archaeology: await sourceNamed('Archaeology'),
    artMuseums: await sourceNamed('Art Museums'),
  };
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a point's change on a refused membership (#2393)", () => {
  it('is asked by the kind that placed the point, where another kind offers the place', async () => {
    // Readers see both points of the cave, whichever kind placed them.
    await altamira('refused', 'admitted');
    const { publicArt, archaeology } = sources;

    const refusing = await renamed('public-art', publicArt);

    expect(asked(refusing.delta)).toEqual(['name']);
    expect(await pointNames()).toEqual(['Cave of Altamira']);
    expect(await pointers(ALTAMIRA)).toEqual({ [publicArt.id]: logs[publicArt.id], [archaeology.id]: null });
  });

  it('is asked by nobody, and kept as the point holds it, where no kind offers the place', async () => {
    await altamira('refused', 'refused');
    const { publicArt, archaeology } = sources;

    for (const [key, source] of [['public-art', publicArt], ['archaeology', archaeology]] as const) {
      const outcome = await renamed(key, source);
      expect(asked(outcome.delta)).toEqual([]);
    }
    expect(await pointNames()).toEqual(['Cave of Altamira']);
    expect(await pointers(ALTAMIRA)).toEqual({ [publicArt.id]: null, [archaeology.id]: null });
  });
});

describe("a work's change on a refused membership (#2393)", () => {
  it('is asked by nobody, and kept as the work holds it, where no kind offers the museum', async () => {
    // The museum as the dev catalogue holds it: Art Museums alone, refused.
    await ghent([[sources.artMuseums, 'refused']]);

    const outcome = await works(sources.artMuseums, { ...WORK, year: 1515 });

    expect(asked(outcome)).toEqual([]);
    expect(await year()).toBe(1510);
    expect(await pointers(GHENT)).toEqual({ [sources.artMuseums.id]: null });
  });

  it('is asked by the kind that placed the work, where another kind offers the museum', async () => {
    const { artMuseums, archaeology } = sources;
    await ghent([[artMuseums, 'refused'], [archaeology, 'admitted']]);

    const outcome = await works(artMuseums, { ...WORK, year: 1515 });

    expect(asked(outcome)).toEqual(['year']);
    expect(await year()).toBe(1510);
    expect(await pointers(GHENT)).toEqual({ [artMuseums.id]: logs[artMuseums.id], [archaeology.id]: null });
  });
});
