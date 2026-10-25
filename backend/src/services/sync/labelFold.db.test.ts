import { afterAll, describe, expect, it } from 'vitest';
import { foldTypography, sameTypography, untypeset } from '@tyr/shared/labels';
import { pool } from '../../db/index.js';
import { sameTypographySql, typographyFoldSql, untypesetSql } from './labelFold.js';

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
  'Shoal Tower,Kingston',
  'Epipolae,Achradina,Tyche and Neapolis, Euryalus Castle, Dionysian forti \ufb01cations',
  'Haselburg,Buergstadt',
  'Tokhwa-ri Tombs No. 1,2,3',
  '"Kluchevskoy" Regional Nature Park"',
  'Southern Kamchatka" Regional Nature Park (two parcels)',
  'Park "Foo',
  '("Foo") Park',
  'Jebel Barisha [Deirouné]',
  '\ufb00\ufb01\ufb02\ufb03\ufb04\ufb05\ufb06',
  'Bridge,\u00e9tage',
  'Park" \\t',
  'Foo" Bar" Baz',
  'a",b',
  'a" \ufb01x',
  'a\ufb01" b',
  'a" "b',
  'Southern Kamchatka"" Regional Park',
  'Battery of 12" guns',
  'Barrel 12"',
  'the \u201cGolden" Gate',
  'Kamchatka\u201d Park',
  '',
];

afterAll(async () => {
  await pool.end();
});

describe("the list's defects mended in SQL (#1965)", () => {
  it('mends every sample as untypeset does', async () => {
    const result = await pool.query<{ mended: string }>(
      `SELECT ${untypesetSql('v')} AS mended FROM unnest($1::text[]) WITH ORDINALITY AS t(v, n) ORDER BY n`,
      [SAMPLES],
    );
    expect(result.rows.map(row => row.mended)).toEqual(SAMPLES.map(untypeset));
    // Its own mend, so the reader's output passes the one-way check.
    expect(SAMPLES.map(sample => untypeset(untypeset(sample)))).toEqual(SAMPLES.map(untypeset));
  });
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
      ['Shoal Tower,Kingston', 'Shoal Tower, Kingston'],
      ['Shoal Tower, Kingston', 'Shoal Tower,Kingston'],
      ['Southern Kamchatka" Regional Nature Park', 'Southern Kamchatka Regional Nature Park'],
      ['Tombs No. 1,2,3', 'Tombs No. 1, 2, 3'],
      ['Fort Ross,California \u201cthe fort\u201d', 'Fort Ross,California "the fort"'],
      ['the \u201cGolden" Gate', 'the \u201cGolden\u201d Gate'],
      ['Park', 'Park\u201d'],
    ];
    const result = await pool.query<{ same: boolean }>(
      `SELECT ${sameTypographySql('s', 'i')} AS same
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t(s, i, n) ORDER BY n`,
      [pairs.map(([stored]) => stored), pairs.map(([, incoming]) => incoming)],
    );
    expect(result.rows.map(row => row.same)).toEqual(pairs.map(([stored, incoming]) => sameTypography(stored, incoming)));
    expect(result.rows.map(row => row.same)).toEqual([true, false, false, true, false, false, false, true, false, true, false, true, true, false]);
  });
});
