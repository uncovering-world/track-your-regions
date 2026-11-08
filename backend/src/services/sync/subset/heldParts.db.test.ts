import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { heldPartsOf } from './heldParts.js';

/**
 * The held parts of a World Heritage listing, read off the local subset
 * (ADR-0185), against PostgreSQL. Fixture rows on real items: the
 * Archaeological Ensemble of Mérida (Q15233334) has the Acueducto de los
 * Milagros (Q3774528) as a part (P527), and the Roman Theatre (Q64850369)
 * names the ensemble as what it is part of (P361); Trajan's Arch
 * (Q64850483) does too, but deprecated. The Archaeological Site of Sabratha
 * (Q15052130) has no part held.
 */

const MERIDA = 'Q15233334';
const AQUEDUCT = 'Q3774528';
const THEATRE = 'Q64850369';
const TRAJANS_ARCH = 'Q64850483';
const SABRATHA = 'Q15052130';

// The spec's own rows: every claim it writes has one of these subjects.
const wipe = () => pool.query('DELETE FROM wikidata_claims WHERE subject = ANY($1::text[])', [[MERIDA, THEATRE, TRAJANS_ARCH]]);

const claim = (subject: string, property: string, item: string, statementId: string, rank = 0) => pool.query(
  'INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value) VALUES ($1, $2, $3, $4, $5, $6)',
  [subject, property, statementId, rank, item, JSON.stringify(item)],
);

beforeAll(async () => {
  await wipe();
  await claim(MERIDA, 'P527', AQUEDUCT, 'M1');
  await claim(THEATRE, 'P361', MERIDA, 'T1');
  await claim(TRAJANS_ARCH, 'P361', MERIDA, 'A1', -1);
});

afterAll(async () => {
  await wipe();
  await pool.end();
});

describe('the parts a kind holds of a listing (ADR-0185)', () => {
  it('reads a held part either way round, one per listing, and none of a listing with no part held', async () => {
    expect(await heldPartsOf([MERIDA, SABRATHA], new Set([THEATRE]))).toEqual(new Map([[MERIDA, THEATRE]]));
    expect(await heldPartsOf([MERIDA], new Set([AQUEDUCT]))).toEqual(new Map([[MERIDA, AQUEDUCT]]));
    expect((await heldPartsOf([MERIDA], new Set([AQUEDUCT, THEATRE]))).size).toBe(1);
  });

  it('reads no deprecated statement, and asks nothing of no listings or no holds', async () => {
    expect(await heldPartsOf([MERIDA], new Set([TRAJANS_ARCH]))).toEqual(new Map());
    expect(await heldPartsOf([], new Set([THEATRE]))).toEqual(new Map());
    expect(await heldPartsOf([MERIDA], new Set())).toEqual(new Map());
  });
});
