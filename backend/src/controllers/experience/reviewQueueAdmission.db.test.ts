import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { getReviewQueue } from './reviewQueueController.js';
import { reviewQueueQuerySchema } from '../../types/index.js';

/**
 * An arrival's card carries why its kind admitted the place, as figures, and
 * the Wikivoyage articles that use the place's item (#2184), executed against
 * PostgreSQL.
 *
 * The fixture is the Temple of Eshmun near Sidon arriving in two kinds at
 * once: Archaeology, by the guides around it, and Places of worship, whose run
 * has written no record yet. The guides are the local copy's articles of its
 * item. Ids are the fixture's own, deleted before and after.
 */

const PLACE = 9610;
const NAME = 'Temple of Eshmun (admission fixture)';
const QID = 'Q9610001';
const OTHER_QID = 'Q9610002';
const ADMIN_UUID = '00000000-0000-4000-8000-000000009610';

const BY_GUIDES = {
  tier: 'surroundings', decided: 'guides', place: { editions: 21, readers: 13_733, guides: 3 },
  reference: { kind: 'typical', editions: 57, readers: 332_715, guides: 8, shares: { readers: 1.5, guides: 0.25 }, radiusKm: 150, best: 10, around: 312 },
};

let adminId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  await pool.query('DELETE FROM wikivoyage_articles WHERE item = ANY($1::text[])', [[QID, OTHER_QID]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN_UUID]);
}

beforeEach(async () => {
  await clear();
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN_UUID],
  );
  adminId = user.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(35.3986, 33.5850), 4326)
       FROM experience_sources s WHERE s.name = 'Archaeology'`,
    [PLACE, QID, NAME],
  );
  // Archaeology's run wrote its record; Places of worship's wrote none yet.
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, admission_evidence)
     SELECT $1, s.kind_id, s.id, $2, 'pending', v.evidence
       FROM (VALUES ('Archaeology', $3::jsonb), ('Places of worship', NULL::jsonb)) AS v(source, evidence)
       JOIN experience_sources s ON s.name = v.source`,
    [PLACE, QID, JSON.stringify(BY_GUIDES)],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

async function arrivals() {
  const queue = await getReviewQueue({
    query: reviewQueueQuerySchema.parse({ q: NAME }),
    caller: { id: adminId, role: 'admin' } as Express.User,
  });
  return queue.arrivals;
}

describe('an arrival\'s admission as figures (#2184)', () => {
  it('carries each kind\'s own record on that kind\'s card, and null where its run wrote none', async () => {
    const cards = await arrivals();
    const byKind = Object.fromEntries(cards.map(card => [card.kind_name, card.admission]));
    expect(byKind).toEqual({ Archaeology: BY_GUIDES, 'Places of worship': null });
  });

  it('links one guide article per edition, the English edition\'s first, each edition its first by title', async () => {
    await pool.query(
      `INSERT INTO wikivoyage_articles (item, site, page_id, title) VALUES
         ($1, 'dewikivoyage', 101, 'Sidon'), ($1, 'enwikivoyage', 202, 'South Lebanon'),
         ($1, 'enwikivoyage', 203, 'Sidon'), ($1, 'frwikivoyage', 304, 'Saïda')`,
      [QID],
    );
    const [card] = await arrivals();
    expect(card.guides).toEqual([
      { title: 'Sidon', url: 'https://en.wikivoyage.org/wiki/Sidon', lang: 'en' },
      { title: 'Sidon', url: 'https://de.wikivoyage.org/wiki/Sidon', lang: 'de' },
      { title: 'Saïda', url: 'https://fr.wikivoyage.org/wiki/Sa%C3%AFda', lang: 'fr' },
    ]);
  });

  it('links none where the copy keeps articles and none uses the item', async () => {
    // Another item's article: the copy in place keeps articles.
    await pool.query(`INSERT INTO wikivoyage_articles (item, site, page_id, title) VALUES ($1, 'enwikivoyage', 401, 'Tyre')`, [OTHER_QID]);
    const cards = await arrivals();
    expect(cards.map(card => card.guides)).toEqual([[], []]);
  });

  it('answers no list at all where the copy keeps no article, which says nothing of a guide', async () => {
    // The copy's articles are set aside for the spec and put back after it: the db lane runs one file at a time.
    const kept = await pool.query<{ item: string; site: string; page_id: number; title: string }>(
      'DELETE FROM wikivoyage_articles RETURNING item, site, page_id, title',
    );
    try {
      const cards = await arrivals();
      expect(cards.map(card => card.guides)).toEqual([null, null]);
    } finally {
      await pool.query(
        `INSERT INTO wikivoyage_articles (item, site, page_id, title)
         SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[])`,
        [kept.rows.map(r => r.item), kept.rows.map(r => r.site), kept.rows.map(r => r.page_id), kept.rows.map(r => r.title)],
      );
    }
  });
});
