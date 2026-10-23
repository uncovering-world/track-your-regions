import { afterAll, describe, expect, it } from 'vitest';
import { foldTypography, sameTypography } from '@tyr/shared/labels';
import { pool } from '../../db/index.js';
import { sameTypographySql, typographyFoldSql } from './labelFold.js';

/**
 * The typography fold spelled for Postgres answers as the TypeScript rule does
 * (#1834): the location writer decides a held point's name with one, and the
 * place's diff with the other.
 */

const SAMPLES = [
  'Maltepe Tumulus\\t',
  'Muradiye (Murad II) Külliye\\t\\t',
  'Drohobych-Tserkva of Saint George\\t ',
  'Australia’s east coast',
  '“the Pearl of the Adriatic”',
  '«Sainte-Chapelle»',
  'Boma–Badingilo — Migratory Landscape',
  '1450−1550',
  'Historic  Centre of Salzburg ',
  'Hollokö',
  'Hollok ö',
  'Hollo' + 'k' + 'ö',
  'a\\tb',
  'Bridge\\n',
  'St Mary‛s ʼ′',
  '',
];

afterAll(async () => {
  await pool.end();
});

describe('the typography fold in SQL', () => {
  it('folds every sample as foldTypography does', async () => {
    const result = await pool.query<{ folded: string }>(
      `SELECT ${typographyFoldSql('v')} AS folded FROM unnest($1::text[]) WITH ORDINALITY AS t(v, n) ORDER BY n`,
      [SAMPLES],
    );
    expect(result.rows.map(row => row.folded)).toEqual(SAMPLES.map(foldTypography));
  });

  it('answers a rewrite as sameTypography does, one way for the escape', async () => {
    const pairs: [string, string][] = [
      ['Maltepe Tumulus\\t', 'Maltepe Tumulus'],
      ['Maltepe Tumulus', 'Maltepe Tumulus\\t'],
      ['Maltepe Tumulus', 'Maltepe Tumulus\\t '],
      ['Australia’s east coast', "Australia's east coast"],
      ['Hollokö', 'Hollok ö'],
      ['a\\tb', 'ab'],
      ['Salzburg', 'Salzburg'],
    ];
    const result = await pool.query<{ same: boolean }>(
      `SELECT ${sameTypographySql('s', 'i')} AS same
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t(s, i, n) ORDER BY n`,
      [pairs.map(([stored]) => stored), pairs.map(([, incoming]) => incoming)],
    );
    expect(result.rows.map(row => row.same)).toEqual(pairs.map(([stored, incoming]) => sameTypography(stored, incoming)));
    expect(result.rows.map(row => row.same)).toEqual([true, false, false, true, false, false, false]);
  });
});
