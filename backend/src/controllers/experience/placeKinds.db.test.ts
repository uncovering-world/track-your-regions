import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { placeKindsSql } from '../../db/membership.js';
import { getWorldPoints } from './worldPointsController.js';

/**
 * A place in several kinds is found in each of them (#1245, ADR-0084), executed
 * against PostgreSQL: which memberships a read finds a place through is decided
 * in SQL.
 *
 * The fixture is the Capitoline Museums as Epic #755 will leave them: one place
 * that Art Museums brought first and that Archaeology also fills, as a museum,
 * under the same Wikidata item (Q333906). Ids and the item are the fixture's
 * own, deleted before and after.
 */

const CAPITOLINE = 9490;
const QID = 'Q9490-capitoline-fixture';
const AROUND_ROME = '12.40,41.85,12.55,41.95';

let artMuseums = { id: 0, kind_id: 0 };
let archaeology = { id: 0, kind_id: 0 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1 OR external_id = $2', [CAPITOLINE, QID]);
}

async function sourceNamed(name: string): Promise<{ id: number; kind_id: number }> {
  const result = await pool.query<{ id: number; kind_id: number }>(
    'SELECT id, kind_id FROM experience_sources WHERE name = $1', [name],
  );
  return result.rows[0];
}

/** The fixture's pins on the markers tier, in a box around Rome. */
async function pins(kindId?: number): Promise<Array<{ kind: number | null; type: string | null }>> {
  const answer = await getWorldPoints({
    query: { detail: 'markers', folded: 'false', bbox: AROUND_ROME, kindId },
  } as never);
  const out: Array<{ kind: number | null; type: string | null }> = [];
  (answer.experienceId ?? []).forEach((id, index) => {
    if (id === CAPITOLINE) out.push({ kind: answer.kindId?.[index] ?? null, type: answer.type?.[index] ?? null });
  });
  return out;
}

beforeEach(async () => {
  await clear();
  artMuseums = await sourceNamed('Art Museums');
  archaeology = await sourceNamed('Archaeology');
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, $3, 'Capitoline Museums', ST_SetSRID(ST_MakePoint(12.48278, 41.89306), 4326))`,
    [CAPITOLINE, artMuseums.id, QID],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships
       (experience_id, kind_id, source_id, external_id, type, curation_state, published_at)
     VALUES ($1, $2, $3, $4, NULL, 'auto', NOW()), ($1, $5, $6, $4, 'museum', 'auto', NOW())`,
    [CAPITOLINE, artMuseums.kind_id, artMuseums.id, QID, archaeology.kind_id, archaeology.id],
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, location, ordinal)
     VALUES ($1, ST_SetSRID(ST_MakePoint(12.48278, 41.89306), 4326), 1)`,
    [CAPITOLINE],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a place in several kinds (ADR-0084)', () => {
  it('carries every kind it is offered in, each with its own type and id', async () => {
    const result = await pool.query(`SELECT ${placeKindsSql('e')} AS kinds FROM experiences e WHERE e.id = $1`, [CAPITOLINE]);

    expect(result.rows[0].kinds).toEqual([
      expect.objectContaining({ kind_id: artMuseums.kind_id, type: null, source_id: artMuseums.id, external_id: QID }),
      expect.objectContaining({ kind_id: archaeology.kind_id, type: 'museum', source_id: archaeology.id, external_id: QID }),
    ]);
  });

  it('leaves out a kind that has not been shown to readers yet', async () => {
    // An arrival nobody has passed: a membership cannot move back to pending
    // (ADR-0070), so the fixture brings it that way.
    await pool.query('DELETE FROM experience_kind_memberships WHERE experience_id = $1 AND source_id = $2', [CAPITOLINE, archaeology.id]);
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, curation_state)
       VALUES ($1, $2, $3, $4, 'museum', 'pending')`,
      [CAPITOLINE, archaeology.kind_id, archaeology.id, QID],
    );

    const result = await pool.query(`SELECT ${placeKindsSql('e')} AS kinds FROM experiences e WHERE e.id = $1`, [CAPITOLINE]);

    expect(result.rows[0].kinds.map((kind: { kind_id: number }) => kind.kind_id)).toEqual([artMuseums.kind_id]);
  });

  it('is on the world map of each of its kinds, as that kind draws it', async () => {
    expect(await pins(archaeology.kind_id)).toEqual([{ kind: archaeology.kind_id, type: 'museum' }]);
    expect(await pins(artMuseums.kind_id)).toEqual([{ kind: artMuseums.kind_id, type: null }]);
    // One pin without a filter, not one per kind.
    expect(await pins()).toHaveLength(1);
  });

  it('is not on the map of a kind whose membership a rule refused', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET admission = 'refused'
        WHERE experience_id = $1 AND source_id = $2`,
      [CAPITOLINE, archaeology.id],
    );

    expect(await pins(archaeology.kind_id)).toEqual([]);
  });
});
