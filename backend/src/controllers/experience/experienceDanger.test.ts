/**
 * Tests for what a list read says about a site being in danger.
 *
 * The badge was drawn from a flag that was false on all 1272 UNESCO rows
 * (#600). What it draws from now comes off the site's World Heritage
 * membership while that stands (#2068), and the year beside it comes out of
 * the string the source sent.
 */

import { describe, it, expect } from 'vitest';
import { dangerSelectSql, withDangerFields } from './experienceDanger.js';

describe('dangerSelectSql', () => {
  it('reads the facts of the World Heritage membership a reader is shown', () => {
    const sql = dangerSelectSql();

    expect(sql).toContain('wh.experience_id = e.id AND wh.kind_id = 1');
    expect(sql).toContain("wh.admission <> 'refused'");
    expect(sql).toContain("wh.source_membership = 'present'");
    // A run that merely missed the site changes nothing a reader sees.
    expect(sql).not.toContain('missing_since');
    expect(sql).toMatch(/AS inscription$/);
    expect(sql).not.toContain('metadata');
  });

  it('takes an alias like the select fragments beside it', () => {
    expect(dangerSelectSql('exp')).toContain('wh.experience_id = exp.id');
  });
});

describe('withDangerFields', () => {
  it('sends the flag as a boolean and the year as a number', () => {
    // Ancient City of Aleppo: on the List of World Heritage in Danger since 2013.
    const row = withDangerFields({
      id: 775, name: 'Ancient City of Aleppo', inscription: { inDanger: true, dangerList: 'Y 2013', criteria: '(iii)(iv)' },
    });

    expect(row).toEqual({
      id: 775, name: 'Ancient City of Aleppo', in_danger: true, danger_since: 2013,
    });
  });

  it('leaves the source\'s own facts on the server', () => {
    // A client parsing "Y 2013" for itself would be a third copy of one rule.
    const row = withDangerFields({ id: 1, inscription: { inDanger: true, dangerList: 'Y 2013' } });

    expect(row).not.toHaveProperty('inscription');
    expect(row).not.toHaveProperty('danger_list');
  });

  it('dates nothing for a site that is not in danger', () => {
    // Belize Barrier Reef Reserve System, taken off the danger list in 2018:
    // the run sends no listing, and a year on a false flag would be a date with
    // nothing to date.
    expect(withDangerFields({ id: 851, inscription: { inDanger: false, dangerList: null } }))
      .toEqual({ id: 851, in_danger: false, danger_since: null });
  });

  it('still says a site is in danger when the listing carries no year', () => {
    expect(withDangerFields({ id: 2, inscription: { inDanger: true, dangerList: null } }))
      .toEqual({ id: 2, in_danger: true, danger_since: null });
  });

  it('draws no badge where no World Heritage membership stands', () => {
    // A place no World Heritage membership holds, or one judged former or refused:
    // the read hands back no facts at all.
    expect(withDangerFields({ id: 4, inscription: null }))
      .toEqual({ id: 4, in_danger: false, danger_since: null });
  });

  it('leaves every other field of the row alone', () => {
    const row = withDangerFields({
      id: 3, name: 'Tyre', kind_name: 'World Heritage Sites',
      inscription: { inDanger: true, dangerList: 'Y 2026' },
    });

    expect(row.name).toBe('Tyre');
    expect(row.kind_name).toBe('World Heritage Sites');
  });
});
