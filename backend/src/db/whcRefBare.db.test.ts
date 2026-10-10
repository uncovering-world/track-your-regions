/**
 * The reference's grammar is stated twice — `parseWhcRef` in TypeScript, where
 * the reference reader resolves a component to its item, and `whc_ref_bare` in
 * SQL, where the run's pairing reads a reference past the inscription's variant
 * (ADR-0090) — and this holds the two to each other on the shapes the list uses.
 * A database-backed spec, since the SQL half is the schema's.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { parseWhcRef } from '../services/sync/unescoWikidata.js';

/** What the TypeScript grammar says the reference is without its variant: the number, and the part as written. */
function bareInTs(value: string): string {
  const folded = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const parsed = parseWhcRef(value);
  if (!parsed) return folded;
  const rest = folded.slice(folded.indexOf(parsed.site) + parsed.site.length + (parsed.variant?.length ?? 0));
  return `${parsed.site}${rest}`;
}

const SHAPES = [
  '527ter-002', '527-002', '829bis-001', '829ter-007', '1133quinquies-039', '1591bis-004',
  '1142-01bis', '1246bis-001f', '292bis', '166rev', '1363-061', ' 1363-061 ', '430ter-328',
  '9840bis-001', '749ter-001', 'X', 'Y', 'RL/02139',
];

afterAll(async () => { await pool.end(); });

describe('whc_ref_bare', () => {
  it("says what parseWhcRef says, for every shape the list uses: the number and the part, never the inscription's variant", async () => {
    const result = await pool.query<{ ref: string; bare: string }>(
      'SELECT r.ref, whc_ref_bare(r.ref) AS bare FROM unnest($1::text[]) AS r(ref)',
      [SHAPES],
    );
    expect(result.rows.map(r => [r.ref, r.bare])).toEqual(SHAPES.map(ref => [ref, bareInTs(ref)]));
  });

  it("folds 829bis-001 and 829ter-001 to one reference, and keeps a part's own suffix", async () => {
    const result = await pool.query<{ a: string; b: string; c: string }>(
      "SELECT whc_ref_bare('829bis-001') AS a, whc_ref_bare('829ter-001') AS b, whc_ref_bare('1142-01bis') AS c",
    );
    expect(result.rows[0]).toEqual({ a: '829-001', b: '829-001', c: '1142-01bis' });
  });
});
