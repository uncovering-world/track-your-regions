import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { readHandOvers, recordHandOvers } from './handOvers.js';

/**
 * A refusal that says a work is another place's is recorded with where it is
 * held, and a works kind reads it back (ADR-0102), against PostgreSQL: Public
 * Art refuses the Bamberg Horseman as inside Bamberg Cathedral — a work it
 * never held as a row — and the places of worship read the hand-over.
 */

const PUBLIC_ART = 3;
const WORSHIP = 4;
const HORSEMAN = 'Q680156-fixture';
const CATHEDRAL = 'Q5924';
const REASON = 'inside Bamberg Cathedral: a work of a place of worship, not public art';
const HORSES = 'Q1994701-fixture';

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_hand_overs WHERE external_id LIKE $1', ['%-fixture']);
}

const recorded = async () => (await pool.query<{ external_id: string; held_in: string[] }>(
  `SELECT external_id, held_in FROM experience_hand_overs WHERE external_id LIKE '%-fixture' ORDER BY external_id`,
)).rows;

beforeEach(clear);

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a refusal records where the work is held (ADR-0102)', () => {
  it('records a refused work with its chain, whether or not the source holds it as a row, for another kind to read', async () => {
    await recordHandOvers(PUBLIC_ART, [
      { externalId: HORSEMAN, name: 'Bamberg Horseman', reason: REASON, heldIn: [CATHEDRAL, 'Q-town-fixture'] },
      { externalId: 'Q-no-place-fixture', name: 'A pin', reason: 'no public-art class' },
    ], null, false);
    expect(await recorded()).toEqual([{ external_id: HORSEMAN, held_in: [CATHEDRAL, 'Q-town-fixture'] }]);

    const handOvers = await readHandOvers(WORSHIP);
    expect(handOvers.get(HORSEMAN)).toEqual({ by: 'Public art', reason: REASON, heldIn: [CATHEDRAL, 'Q-town-fixture'] });
    // A kind's own refusals are no hand-over to itself.
    expect((await readHandOvers(PUBLIC_ART)).has(HORSEMAN)).toBe(false);
  });

  it("replaces the source's set: a work the next run no longer refuses this way leaves it", async () => {
    await recordHandOvers(PUBLIC_ART, [
      { externalId: HORSEMAN, name: 'Bamberg Horseman', reason: REASON, heldIn: [CATHEDRAL] },
      { externalId: HORSES, name: 'Horses of Saint Mark', reason: "in the collection of St Mark's Basilica", heldIn: ['Q172988'] },
    ], null, false);
    await recordHandOvers(PUBLIC_ART, [
      { externalId: HORSES, name: 'Horses of Saint Mark', reason: "in the collection of St Mark's Basilica", heldIn: ['Q172988'] },
    ], null, false);
    expect((await recorded()).map((row) => row.external_id)).toEqual([HORSES]);
  });

  it('writes nothing on a dry run', async () => {
    await recordHandOvers(PUBLIC_ART, [{ externalId: HORSEMAN, name: 'Bamberg Horseman', reason: REASON, heldIn: [CATHEDRAL] }], null, true);
    expect(await recorded()).toEqual([]);
  });
});
