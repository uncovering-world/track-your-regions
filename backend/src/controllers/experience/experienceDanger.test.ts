/**
 * Tests for what a list read says about a site being in danger.
 *
 * The badge was drawn from a flag that was false on all 1272 UNESCO rows
 * (#600). What it draws from now still comes out of the row, and the year
 * beside it comes out of the string the source sent.
 */

import { describe, it, expect } from 'vitest';
import { dangerSelectSql, withDangerFields } from './experienceDanger.js';

describe('dangerSelectSql', () => {
  it('names both columns the reader-facing fields are read from', () => {
    const sql = dangerSelectSql();

    expect(sql).toContain("e.metadata->>'inDanger' as in_danger");
    expect(sql).toContain("e.metadata->>'dangerList' as danger_list");
  });

  it('takes an alias like the select fragments beside it', () => {
    // Every caller passes `e` today. The parameter is `lifecycleSelectSql`'s
    // shape rather than a need already felt, and it is pinned so a query that
    // does alias its table gets the columns rather than a silent `e.` that
    // resolves to a different one.
    expect(dangerSelectSql('exp')).toContain("exp.metadata->>'inDanger'");
  });
});

describe('withDangerFields', () => {
  it('sends the flag as a boolean and the year as a number', () => {
    // Ancient City of Aleppo: on the List of World Heritage in Danger since 2013.
    const row = withDangerFields({
      id: 775, name: 'Ancient City of Aleppo', in_danger: 'true', danger_list: 'Y 2013',
    });

    expect(row).toEqual({
      id: 775, name: 'Ancient City of Aleppo', in_danger: true, danger_since: 2013,
    });
  });

  it('leaves the source\'s own string on the server', () => {
    // A client parsing "Y 2013" for itself would be a third copy of one rule.
    const row = withDangerFields({ id: 1, in_danger: 'true', danger_list: 'Y 2013' });

    expect(row).not.toHaveProperty('danger_list');
  });

  it('dates nothing for a site that is not in danger', () => {
    // Belize Barrier Reef Reserve System, delisted in 2018: the row carries no
    // listing, and a year on a false flag would be a date with nothing to date.
    expect(withDangerFields({ id: 851, in_danger: 'false', danger_list: null }))
      .toEqual({ id: 851, in_danger: false, danger_since: null });
  });

  it('still says a site is in danger when the listing carries no year', () => {
    expect(withDangerFields({ id: 2, in_danger: 'true', danger_list: null }))
      .toEqual({ id: 2, in_danger: true, danger_since: null });
  });

  it('leaves every other field of the row alone', () => {
    const row = withDangerFields({
      id: 3, name: 'Tyre', category_name: 'UNESCO World Heritage Sites',
      in_danger: 'true', danger_list: 'Y 2026',
    });

    expect(row.name).toBe('Tyre');
    expect(row.category_name).toBe('UNESCO World Heritage Sites');
  });
});
