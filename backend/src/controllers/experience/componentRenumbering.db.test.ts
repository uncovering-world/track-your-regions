import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { queryWithdrawn } from './reviewQueueContents.js';
import { writeExperienceLocations, type LocationWriteRun } from '../../services/sync/locationWriter.js';

/**
 * A serial site whose list UNESCO renumbers keeps one part per component
 * (#2182), against PostgreSQL. Western Tien-Shan (1490) on the development
 * catalogue: the run of 2026-10-25 met a list renumbered from 13 components to
 * 11, read each new number as the component the old number had named, and made
 * a second part of every reserve, while the two numbers that left the list,
 * 1490-012 and 1490-013, were asked about as lost though the Chatkal reserve's
 * two areas are still listed under 1490-010 and 1490-011.
 *
 * The fixture keeps the coordinates of the real list: the Maidantal area
 * renumbered at its point, the Bashkizilsay area renumbered and moved 3.5 km,
 * the Boraldaitau area renumbered and moved 85 km, the Karatau reserve moved
 * 1.9 km under its own number, and the Karabastau area dropped.
 */

const SITE = 9953;

const KARATAU = { name: 'Karatau State Nature Reserve', externalRef: '1490-001', lon: 68.6789, lat: 43.7333 };
const KARABASTAU = { name: 'Aksu-Jabagly State Nature Reserve – Karabastau paleontological area', externalRef: '1490-003', lon: 69.9150, lat: 42.9400 };
const BORALDAITAU = { name: 'Sairam-Ugam State National Nature Park – Boraldaitau area', externalRef: '1490-005', lon: 70.0135, lat: 41.9577 };
const MAIDANTAL = { name: 'The Chatkal State Biosphere Nature Reserve – Maidantal area', externalRef: '1490-012', lon: 70.2550, lat: 41.3014 };
const BASHKIZILSAY = { name: 'The Chatkal State Biosphere Nature Reserve – Bashkizilsay area', externalRef: '1490-013', lon: 69.9342, lat: 41.2100 };

const BEFORE = [KARATAU, KARABASTAU, BORALDAITAU, MAIDANTAL, BASHKIZILSAY];
const AFTER = [
  { ...KARATAU, lat: 43.7167 },
  { ...BORALDAITAU, externalRef: '1490-003', lon: 70.2211, lat: 42.7158 },
  { ...MAIDANTAL, externalRef: '1490-010' },
  { ...BASHKIZILSAY, externalRef: '1490-011', lon: 69.8917 },
];

let run: LocationWriteRun;
let sourceId: number;

interface PartRow {
  part_id: number;
  relation_ref: string | null;
  part_name: string;
  points: Array<{ id: number; ref: string; missing: boolean; pending: boolean; held: number | null }>;
}

/** Each part of the site with its points, by the name the part carries. */
async function parts(): Promise<Map<string, PartRow>> {
  const rows = (await pool.query<PartRow>(
    `SELECT p.part_id, p.external_ref AS relation_ref, e.name AS part_name,
            jsonb_agg(jsonb_build_object('id', el.id, 'ref', el.external_ref, 'missing', el.missing_since IS NOT NULL,
                                         'pending', el.curation_state = 'pending',
                                         'held', el.withdrawal_deferred_for_location_id) ORDER BY el.id) AS points
       FROM experience_parts p
       JOIN experiences e ON e.id = p.part_id
       JOIN experience_locations el ON el.experience_id = p.part_id
      WHERE p.whole_id = $1 AND p.reason = 'component'
      GROUP BY p.part_id, p.external_ref, e.name`, [SITE],
  )).rows;
  return new Map(rows.map(row => [row.part_name, row]));
}

async function partLocation(partId: number): Promise<{ lon: number; lat: number }> {
  return (await pool.query<{ lon: number; lat: number }>(
    'SELECT ST_X(location) AS lon, ST_Y(location) AS lat FROM experiences WHERE id = $1', [partId],
  )).rows[0];
}

/** The withdrawn-point card's rows for the site, as the review queue reads them. */
async function withdrawnCard(): Promise<Array<{ name: string; replacedMetres: number | null; replacedRef: string | null }>> {
  const result = await queryWithdrawn({ scopeFilter: 'TRUE', sourceFilter: 'AND TRUE', params: [0], ids: [SITE] });
  const points = (result.rows[0]?.withdrawn_points ?? []) as Array<{ name: string; replacedMetres: number | null; replacedRef: string | null }>;
  return points.map(point => ({ name: point.name, replacedMetres: point.replacedMetres, replacedRef: point.replacedRef }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function gate(on: boolean): Promise<void> {
  await pool.query('UPDATE experience_sources SET requires_curation = $2 WHERE id = $1', [sourceId, on]);
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id IN (SELECT part_id FROM experience_parts WHERE whole_id = $1)', [SITE]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [SITE]);
}

let wasGated: boolean;

beforeEach(async () => {
  await clear();
  const source = (await pool.query<{ id: number; kind_id: number; requires_curation: boolean }>(
    `SELECT id, kind_id, requires_curation FROM experience_sources WHERE name = 'UNESCO World Heritage Sites'`,
  )).rows[0];
  sourceId = source.id;
  wasGated ??= source.requires_curation;
  await gate(false);
  run = { syncLogId: null, sourceId, components: true };
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, '1490-fixture', 'Western Tien-Shan (renumbering fixture)', ST_SetSRID(ST_MakePoint(70.27, 42.40), 4326))`,
    [SITE, sourceId],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     VALUES ($1, $2, $3, '1490-fixture', 'auto', NOW())`,
    [SITE, source.kind_id, sourceId],
  );
  await writeExperienceLocations(SITE, BEFORE, run);
});

afterAll(async () => {
  await clear();
  if (wasGated !== undefined) await gate(wasGated);
  await pool.end();
});

describe('a renumbered list keeps one part per component (#2182)', () => {
  it('keeps a component renumbered at its point as its one row, under the new number', async () => {
    const before = (await parts()).get(MAIDANTAL.name)!;
    await writeExperienceLocations(SITE, AFTER, run);

    const maidantal = (await parts()).get(MAIDANTAL.name)!;
    expect(maidantal.part_id).toBe(before.part_id);
    expect(maidantal.relation_ref).toBe('1490-010');
    expect(maidantal.points).toEqual([{ id: before.points[0].id, ref: '1490-010', missing: false, pending: false, held: null }]);
  });

  it('puts a moved component, renumbered or not, on the part it moved from, without a gate', async () => {
    const before = await parts();
    await writeExperienceLocations(SITE, AFTER, run);
    const after = await parts();

    // No part is made: the five components are the five parts they were.
    expect([...after.values()].map(p => p.part_id).sort()).toEqual([...before.values()].map(p => p.part_id).sort());
    for (const [component, ref] of [[BORALDAITAU, '1490-003'], [BASHKIZILSAY, '1490-011'], [KARATAU, '1490-001']] as const) {
      const part = after.get(component.name)!;
      expect(part.part_id).toBe(before.get(component.name)!.part_id);
      expect(part.points.map(p => [p.ref, p.missing])).toEqual([[component.externalRef, true], [ref, false]]);
      // The part follows the point a reader sees.
      expect(part.relation_ref).toBe(ref);
      const arrival = AFTER.find(p => p.name === component.name)!;
      const location = await partLocation(part.part_id);
      expect(location.lon).toBeCloseTo(arrival.lon, 4);
      expect(location.lat).toBeCloseTo(arrival.lat, 4);
    }
    // The component the list dropped is the one part with no point standing.
    expect(after.get(KARABASTAU.name)!.points.map(p => p.missing)).toEqual([true]);
  });

  it('asks about a moved component as moved, with its new number, and about the dropped one as gone', async () => {
    await writeExperienceLocations(SITE, AFTER, run);

    const card = await withdrawnCard();
    expect(card.map(row => [row.name, row.replacedRef])).toEqual([
      [KARABASTAU.name, null],
      [KARATAU.name, null],
      [BORALDAITAU.name, '1490-003'],
      [BASHKIZILSAY.name, '1490-011'],
    ]);
    const metres = Object.fromEntries(card.map(row => [row.name, row.replacedMetres]));
    expect(metres[KARABASTAU.name]).toBeNull();
    expect(metres[BASHKIZILSAY.name]).toBeGreaterThan(3000);
    expect(metres[BORALDAITAU.name]).toBeGreaterThan(80_000);
  });

  it('holds each moved component by its own arrival, on its own part, under a gate', async () => {
    const before = await parts();
    await gate(true);
    try {
      await writeExperienceLocations(SITE, AFTER, run);
    } finally {
      await gate(false);
    }
    const after = await parts();

    expect([...after.values()].map(p => p.part_id).sort()).toEqual([...before.values()].map(p => p.part_id).sort());
    for (const component of [BORALDAITAU, BASHKIZILSAY, KARATAU]) {
      const [old, arrival] = after.get(component.name)!.points;
      expect(old).toMatchObject({ missing: false, pending: false });
      expect(arrival).toMatchObject({ missing: false, pending: true, held: old.id });
      // The part stays where readers see it until a curator publishes the move.
      expect(after.get(component.name)!.relation_ref).toBe(component.externalRef);
    }
    expect(after.get(MAIDANTAL.name)!.points).toHaveLength(1);
    expect(after.get(KARABASTAU.name)!.points.map(p => p.missing)).toEqual([true]);
  });

  it('keeps a row under the number that stayed, though a namesake under a new number is listed first', async () => {
    const before = (await parts()).get(MAIDANTAL.name)!;
    // Two numbers, one name, one spot, the new one first: the row is the number
    // that names it, and the namesake arrives as a component of its own.
    await writeExperienceLocations(SITE, [
      { ...MAIDANTAL, externalRef: '1490-014' }, KARATAU, KARABASTAU, BORALDAITAU, MAIDANTAL, BASHKIZILSAY,
    ], run);

    const kept = await pool.query<{ external_ref: string; missing: boolean }>(
      'SELECT external_ref, missing_since IS NOT NULL AS missing FROM experience_locations WHERE id = $1',
      [before.points[0].id],
    );
    expect(kept.rows[0]).toEqual({ external_ref: '1490-012', missing: false });
    const named = await pool.query<{ external_ref: string }>(
      `SELECT el.external_ref FROM experience_locations el
        WHERE el.name = $1 AND el.missing_since IS NULL
          AND el.experience_id IN (SELECT part_id FROM experience_parts WHERE whole_id = $2)
        ORDER BY el.external_ref`, [MAIDANTAL.name, SITE],
    );
    expect(named.rows.map(row => row.external_ref)).toEqual(['1490-012', '1490-014']);
  });

  it('writes the renumbered list again without a change', async () => {
    await writeExperienceLocations(SITE, AFTER, run);
    const first = await parts();
    await writeExperienceLocations(SITE, AFTER, run);
    expect(await parts()).toEqual(first);
  });
});
