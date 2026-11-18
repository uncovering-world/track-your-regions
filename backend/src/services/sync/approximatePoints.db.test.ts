import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { COMPONENT_SOURCE_ID } from '../../db/membership.js';
import { partLinePointSql, pointRoughSql } from '../../db/placePoints.js';
import { writeExperienceLocations } from './locationWriter.js';

/**
 * The World Heritage run records how roughly the list placed each component
 * (#1853), on the line's record and, until the points go, on its point
 * (#2123); every reader reads it through `pointRoughSql`, which each case
 * holds to the point's mark. The fixture is Echmiatsin and Zvartnots (1011)
 * as the list gives it: three components on the property's own point, one
 * given to the second, and the Longmen Grottoes' kind of point, to the whole
 * minute. Ids are the fixture's own, deleted before and after.
 */

const SITE = 9853;
const UNESCO = 1;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

const OF_SITE = 'el.experience_id = $1 OR el.experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)';

/** Each point's mark, as the run stored it. */
const stored = async () => (await pool.query<{ ref: string; approximate: string | null }>(
  `SELECT external_ref AS ref, approximate FROM experience_locations el WHERE ${OF_SITE} ORDER BY external_ref, el.id`, [SITE],
)).rows;

/** Each point as a reader reads it, off its line's record. */
const read = async () => (await pool.query<{ ref: string; approximate: string | null }>(
  `SELECT external_ref AS ref, ${pointRoughSql('el')} AS approximate FROM experience_locations el
    WHERE ${OF_SITE} ORDER BY external_ref, el.id`, [SITE],
)).rows;

/** The mark, after holding the reader's reading to the stored one: the two must agree until the points go. */
const recorded = async () => {
  const marks = await stored();
  expect(await read()).toEqual(marks);
  // And the line test the reader writes out to the schema's own (partLinePointSql).
  const lines = (await pool.query<{ same: boolean }>(
    `SELECT is_part_line_point(el.id, w.whole_id) = ${partLinePointSql('el', 'w.whole_id')} AS same
       FROM experience_locations el JOIN experience_parts w ON w.part_id = el.experience_id
      WHERE w.whole_id = $1`, [SITE],
  )).rows;
  expect(lines.every(line => line.same)).toBe(true);
  return marks;
};

/** What each line's record says of the list's coordinate. */
const records = async () => (await pool.query<{ ref: string; rough: string | null }>(
  `SELECT external_id AS ref, reported_location_rough AS rough FROM source_records
    WHERE source_id = $2 AND whole_id = $1 ORDER BY external_id`, [SITE, COMPONENT_SOURCE_ID],
)).rows;

const RUN = { syncLogId: null, sourceId: UNESCO, components: true };

const SHARED = { lon: 44.2951388889, lat: 40.1593055556 };
const points = [
  { externalRef: '1011-001', name: 'Mother Cathedral of Echmiatsin', ...SHARED },
  { externalRef: '1011-002', name: 'Church Saint Gayaneh', ...SHARED },
  { externalRef: '1011-003', name: 'Cemetery of Congregation', ...SHARED },
  { externalRef: '1011-006', name: 'Archaeological site of Zvartnots', lon: 44.3246388889, lat: 40.1586666667 },
  { externalRef: '1011-007', name: 'A component to the whole minute', lon: 44.3, lat: 40.15 },
];

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '9853', 'Echmiatsin fixture', ST_SetSRID(ST_MakePoint(44.2951388889, 40.1593055556), 4326))`,
    [SITE, UNESCO],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, '9853', 'verified', NOW() FROM experience_sources s WHERE s.id = $2`,
    [SITE, UNESCO],
  );
});

/** The area UNESCO inscribed, on the site's World Heritage membership's inscription (#2068, #2127). */
const inscribe = (hectares: number) => pool.query(
  `INSERT INTO record_heritage_inscriptions (record_id, area_ha, transboundary)
   SELECT m.id, $2::numeric, false FROM source_records m WHERE m.experience_id = $1 AND m.kind_id = 1
   ON CONFLICT (record_id) DO UPDATE SET area_ha = EXCLUDED.area_ha`, [SITE, hectares],
);

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('how roughly the list placed a component', () => {
  it('records a shared point and a whole minute, and nothing for a point given to the second', async () => {
    await writeExperienceLocations(SITE, points, { syncLogId: null, sourceId: UNESCO, components: true });

    expect(await recorded()).toEqual([
      { ref: '1011-001', approximate: 'shared' },
      { ref: '1011-002', approximate: 'shared' },
      { ref: '1011-003', approximate: 'shared' },
      { ref: '1011-006', approximate: null },
      { ref: '1011-007', approximate: 'whole-minute' },
    ]);
  });

  it('leaves the mark of a point a curator placed as the curator left it', async () => {
    await writeExperienceLocations(SITE, points, { syncLogId: null, sourceId: UNESCO, components: true });
    // As correctPoint leaves it: the coordinate claimed, the mark cleared.
    await pool.query(
      `UPDATE experience_locations SET curated_fields = '["location"]'::jsonb, approximate = NULL
        WHERE external_ref = '1011-007'
          AND (experience_id = $1 OR experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1))`,
      [SITE],
    );
    // A second run with a component more, so the writer leaves its fast path.
    const added = { externalRef: '1011-008', name: 'A component given to the second', lon: 44.3112222222, lat: 40.1612777778 };
    await writeExperienceLocations(SITE, [...points, added], { syncLogId: null, sourceId: UNESCO, components: true });

    const after = await recorded();
    expect(after.find(p => p.ref === '1011-007')?.approximate).toBeNull();
    expect(after.find(p => p.ref === '1011-001')?.approximate).toBe('shared');
    expect(after.find(p => p.ref === '1011-008')?.approximate).toBeNull();
  });

  it('judges each point of a reference listed once per country by its own coordinate', async () => {
    // One reference, two countries: one point to the whole minute, one given to the second.
    await writeExperienceLocations(SITE, [
      { externalRef: '1011-009', name: 'Across the border (one side)', lon: 44.3, lat: 40.15 },
      { externalRef: '1011-009', name: 'Across the border (other side)', lon: 44.3112222222, lat: 40.1612777778 },
    ], { syncLogId: null, sourceId: UNESCO, components: true });

    const rows = (await pool.query<{ lon: number; approximate: string | null }>(
      `SELECT ST_X(location) AS lon, approximate FROM experience_locations
        WHERE external_ref = '1011-009'
          AND (experience_id = $1 OR experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1))
        ORDER BY lon`, [SITE],
    )).rows;
    expect(rows.map(row => row.approximate)).toEqual(['whole-minute', null]);
  });

  it('leaves a point that stands for a site ten times its minute unmarked (#1903)', async () => {
    // The Okavango Delta, 2 023 590 ha, given one point to the whole minute: it stands for the delta well enough.
    await inscribe(2023590);
    await writeExperienceLocations(SITE, [{ externalRef: '9853', name: 'Okavango fixture', lon: 22.9, lat: -19.3 }],
      { syncLogId: null, sourceId: UNESCO, components: true });
    expect(await recorded()).toEqual([{ ref: '9853', approximate: null }]);
    // The run resolves the area on the record, so a reader compares only the point with it.
    expect(await records()).toEqual([{ ref: '9853', rough: null }]);
  });

  it("still marks a compact site's own point (#1903)", async () => {
    // The Longmen Grottoes, 331 ha, whose list point stands 10 km from the caves: still asked.
    await inscribe(331);
    await writeExperienceLocations(SITE, [{ externalRef: '9853', name: 'Longmen fixture', lon: 112.4666666667, lat: 34.4666666667 }],
      { syncLogId: null, sourceId: UNESCO, components: true });
    expect(await recorded()).toEqual([{ ref: '9853', approximate: 'whole-minute' }]);
  });

  it('marks the same point again when only the site\'s area crosses its minute ten times', async () => {
    const wholeSite = [{ externalRef: '9853', name: 'Okavango fixture', lon: 22.9, lat: -19.3 }];
    const run = { syncLogId: null, sourceId: UNESCO, components: true };
    await inscribe(331);
    await writeExperienceLocations(SITE, wholeSite, run);
    expect(await recorded()).toEqual([{ ref: '9853', approximate: 'whole-minute' }]);

    // The same point offered again: only the area moved, past the fast path that leaves points as they are.
    await inscribe(2023590);
    await writeExperienceLocations(SITE, wholeSite, run);
    expect(await recorded()).toEqual([{ ref: '9853', approximate: null }]);
  });
});

describe("the line's record holds how roughly the list placed it", () => {
  it('holds the list\'s view whatever a curator made of the point, and the reading follows the claim', async () => {
    await writeExperienceLocations(SITE, points, RUN);
    expect(await records()).toEqual([
      { ref: '1011-001', rough: 'shared' },
      { ref: '1011-002', rough: 'shared' },
      { ref: '1011-003', rough: 'shared' },
      { ref: '1011-006', rough: null },
      { ref: '1011-007', rough: 'whole-minute' },
    ]);

    const claim = (fields: string) => pool.query(
      `UPDATE experience_locations el SET curated_fields = $2::jsonb WHERE external_ref = '1011-007' AND (${OF_SITE})`,
      [SITE, fields],
    );
    // A curator who keeps the list's point answers where it stands: same coordinate, a claim on it.
    await claim('["location"]');
    expect((await read()).find(p => p.ref === '1011-007')?.approximate).toBeNull();
    expect((await records()).find(r => r.ref === '1011-007')?.rough).toBe('whole-minute');
    // The claim taken back, the point is the list's rough one again, with no run in between.
    await claim('[]');
    expect((await read()).find(p => p.ref === '1011-007')?.approximate).toBe('whole-minute');
  });

  it('reads a point that no longer stands at its line\'s coordinate as placed', async () => {
    await writeExperienceLocations(SITE, points, RUN);
    await pool.query(
      `UPDATE experience_locations el SET location = ST_SetSRID(ST_MakePoint(44.3001, 40.1501), 4326)
        WHERE external_ref = '1011-007' AND (${OF_SITE})`, [SITE],
    );
    expect((await read()).find(p => p.ref === '1011-007')?.approximate).toBeNull();
  });

  it('keeps the ring of a point a held move leaves at the list\'s old rough coordinate', async () => {
    // A deployment whose World Heritage source is gated: a component arrives unread and a curator
    // passes it, and a move of a passed point waits for the curator.
    const gated = (await pool.query<{ requires_curation: boolean }>(
      'SELECT requires_curation FROM experience_sources WHERE id = $1', [UNESCO],
    )).rows[0].requires_curation;
    await pool.query('UPDATE experience_sources SET requires_curation = TRUE WHERE id = $1', [UNESCO]);
    try {
      await writeExperienceLocations(SITE, points, RUN);
      await pool.query(
        `UPDATE experience_locations el SET curation_state = 'verified' WHERE curation_state = 'pending' AND (${OF_SITE})`,
        [SITE],
      );
      // The list gives the whole-minute component to the second now, 1.3 km away: the move
      // waits as an unread arrival, and the record moves at once.
      const moved = points.map(point => (point.externalRef === '1011-007' ? { ...point, lon: 44.3112222222, lat: 40.1612777778 } : point));
      await writeExperienceLocations(SITE, moved, RUN);
    } finally {
      await pool.query('UPDATE experience_sources SET requires_curation = $2 WHERE id = $1', [UNESCO, gated]);
    }

    const component = (await pool.query<{ state: string; deferred: boolean; approximate: string | null }>(
      `SELECT el.curation_state AS state, el.withdrawal_deferred_for_location_id IS NOT NULL AS deferred,
              ${pointRoughSql('el')} AS approximate
         FROM experience_locations el
        WHERE el.external_ref = '1011-007' AND el.merged_into_id IS NULL AND el.missing_since IS NULL AND (${OF_SITE})
        ORDER BY el.id`, [SITE],
    )).rows;
    expect(component).toEqual([
      { state: 'verified', deferred: false, approximate: 'whole-minute' },
      { state: 'pending', deferred: true, approximate: null },
    ]);
    expect((await records()).find(r => r.ref === '1011-007')?.rough).toBeNull();
    // Nothing holds it back any more: the point stands off its line's coordinate, as one a curator placed.
    await pool.query(
      `UPDATE experience_locations el SET withdrawal_deferred_for_location_id = NULL WHERE external_ref = '1011-007' AND (${OF_SITE})`,
      [SITE],
    );
    expect((await read()).filter(p => p.ref === '1011-007').map(p => p.approximate)).toEqual([null, null]);
  });

  it('takes a change of the site\'s area at its next run, which writes the record again', async () => {
    const wholeSite = [{ externalRef: '9853', name: 'Okavango fixture', lon: 22.9, lat: -19.3 }];
    await inscribe(331);
    await writeExperienceLocations(SITE, wholeSite, RUN);
    expect(await records()).toEqual([{ ref: '9853', rough: 'whole-minute' }]);
    // The area is a run's write: until the run, the record says what it said.
    await inscribe(2023590);
    expect((await read())[0].approximate).toBe('whole-minute');
    await writeExperienceLocations(SITE, wholeSite, RUN);
    expect(await records()).toEqual([{ ref: '9853', rough: null }]);
    expect((await read())[0].approximate).toBeNull();
  });

  it('is written again by a run whose list reads otherwise, past the fast path', async () => {
    await writeExperienceLocations(SITE, points, RUN);
    await pool.query(
      `UPDATE source_records SET reported_location_rough = NULL WHERE source_id = $2 AND whole_id = $1`,
      [SITE, COMPONENT_SOURCE_ID],
    );
    await writeExperienceLocations(SITE, points, RUN);
    expect((await records()).map(r => r.rough)).toEqual(['shared', 'shared', 'shared', null, 'whole-minute']);
  });
});
